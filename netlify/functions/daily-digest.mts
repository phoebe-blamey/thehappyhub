import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ════════════════════════════════════════════════════════════════════
// v11743 — DAILY DIGEST scheduled function
// ════════════════════════════════════════════════════════════════════
// Phoebe's coaching insight: "Get them to commit and complete the
// action. They don't do what they're supposed to do so nothing for
// them changes." This is the nudge half — every morning at 8am AEST
// each active client gets a brief email digest of what's actually
// on their plate today, with ONE-TAP completion links embedded.
//
// Digest content per client:
//   • Tasks due today (clientVisible)
//   • Overdue tasks (1-7 days)
//   • Yesterday's daily commit — did you do it? (one-tap)
//   • Upcoming session in next 3 days
//   • Weekly check-in nudge (Monday morning, if not submitted yet)
//
// Skips:
//   • Clients with notificationsDisabled = true
//   • Clients with no actionable items today
//   • Test / archived clients
//
// Cadence: daily at 22:00 UTC (8am AEST / 9am AEDT). Cron string in
// the scheduled config below.
//
// Sends via the same Gmail OAuth pipeline /api/send-message uses
// (HTTP self-call so the email-sending code lives in one place).
//
// Tracks sent digests in the `reminders` blob store keyed by
// clientId + YYYY-MM-DD so duplicate fires are safe.
// ════════════════════════════════════════════════════════════════════

import { buildQuickActionUrl } from "./quick-action.mts";

const ALWAYS_SKIP = new Set(["inquiry", "mdc-inquiry", "podcast", "partner", "research", "general"]);

function todayKey(d: Date) { return d.toISOString().slice(0, 10); }
function yesterdayKey(d: Date) {
  const y = new Date(d.getTime() - 86400000);
  return todayKey(y);
}
function sydneyDay(d: Date) {
  // 0 Sun … 6 Sat in Sydney time
  const sydney = new Date(d.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
  return sydney.getDay();
}
function isMonday(d: Date) { return sydneyDay(d) === 1; }
function isFriday(d: Date) { return sydneyDay(d) === 5; }
function isoMondayOfWeek(d: Date) {
  const sydney = new Date(d.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
  const dow = sydney.getDay();
  const diff = (dow + 6) % 7;
  sydney.setDate(sydney.getDate() - diff);
  return sydney.toISOString().slice(0, 10);
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  } catch { return iso; }
}
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return ""; }
}

interface DigestItem {
  kind: "task-due" | "task-overdue" | "session" | "commit-followup" | "checkin" | "fri-unfinished";
  text: string;
  link?: string;
  meta?: string;
}

function buildDigestForClient(client: any, secret: string, base: string, now: Date): DigestItem[] {
  const items: DigestItem[] = [];
  const today = todayKey(now);
  const yesterday = yesterdayKey(now);

  // ── Yesterday's daily commit follow-up (highest accountability lever) ──
  if (client.dailyCommits && client.dailyCommits[yesterday]) {
    const raw = client.dailyCommits[yesterday];
    const alreadyDone = raw.indexOf("✓") === 0;
    if (!alreadyDone) {
      const link = buildQuickActionUrl(base, "commit-done", client.id, yesterday, secret);
      items.push({
        kind: "commit-followup",
        text: `Yesterday you said you'd: "${raw.trim().slice(0, 100)}"`,
        link,
        meta: "✓ Mark done",
      });
    }
  }

  // ── Tasks due today / overdue ──
  const tasks = Array.isArray(client.tasks) ? client.tasks : [];
  const overdueWindow = 7 * 86400000;
  const nowMs = now.getTime();
  tasks.forEach((t: any) => {
    if (!t || t.completed || t.archived || t.deleted) return;
    if (!t.clientVisible) return;
    if (!t.dueDate) return;
    const due = new Date(t.dueDate).getTime();
    if (isNaN(due)) return;
    const isToday = t.dueDate === today;
    const isOverdue = due < new Date(today).getTime();
    if (!isToday && !isOverdue) return;
    if (isOverdue && (nowMs - due) > overdueWindow) return; // skip very old
    const link = buildQuickActionUrl(base, "task-done", client.id, t.id, secret);
    items.push({
      kind: isToday ? "task-due" : "task-overdue",
      text: t.text || "Untitled task",
      link,
      meta: isOverdue ? "✓ Mark done (overdue " + Math.floor((nowMs - due) / 86400000) + "d)" : "✓ Mark done",
    });
  });

  // ── Upcoming session in next 3 days ──
  const next3 = new Date(now.getTime() + 3 * 86400000);
  (client.programs || []).forEach((p: any) => {
    if (!p || ALWAYS_SKIP.has(p.workbook)) return;
    if (!p.sessionDate) return;
    const sess = new Date(p.sessionDate);
    if (isNaN(sess.getTime())) return;
    if (sess < now) return;
    if (sess > next3) return;
    const dateStr = fmtDate(p.sessionDate);
    let metaPart = "";
    if (p.zoomJoin) metaPart = "🎬 Join Zoom: " + p.zoomJoin;
    items.push({
      kind: "session",
      text: `${(p.label || p.program)} on ${dateStr}`,
      meta: metaPart,
    });
  });

  // ── Weekly check-in nudge (Monday only, if not submitted yet) ──
  if (isMonday(now)) {
    const thisWeek = isoMondayOfWeek(now);
    const submitted = (client.weeklyCheckins || []).some((c: any) => c && c.weekOf === thisWeek);
    if (!submitted) {
      const link = buildQuickActionUrl(base, "checkin-now", client.id, thisWeek, secret);
      items.push({
        kind: "checkin",
        text: "Your weekly check-in is open — four questions, two minutes.",
        link,
        meta: "Open check-in",
      });
    }
  }

  // ── Friday reflection: tasks set this week that DIDN'T get done ──
  // Phoebe wants to know what blocked them. Each unfinished task gets a
  // "tell Phoebe what blocked you" link that opens a portal page where
  // the client types the reason — submission logs as "needs-support" on
  // the client record + emails Phoebe.
  if (isFriday(now)) {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const unfinishedThisWeek = tasks.filter((t: any) => {
      if (!t || t.completed || t.archived || t.deleted) return false;
      if (!t.clientVisible) return false;
      if (!t.createdAt) return false;
      return t.createdAt >= sevenDaysAgo;
    });
    unfinishedThisWeek.forEach((t: any) => {
      const link = `${base}/?client=${encodeURIComponent(client.clientAccess || "")}&blocked=${encodeURIComponent(t.id)}`;
      items.push({
        kind: "fri-unfinished",
        text: t.text || "Untitled task",
        link,
        meta: "💬 Tell Phoebe what blocked you",
      });
    });
  }

  return items;
}

// v11746: helper — pull saved email templates from coach-settings blob,
// fall back to default. Phoebe edits these in Settings → Email templates.
async function _readEmailTemplate(key: string): Promise<{ subject: string; body: string } | null> {
  try {
    const store = getStore("coach-settings");
    const raw = await store.get("coach-settings");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj.emailTemplates || !obj.emailTemplates[key]) return null;
    return {
      subject: obj.emailTemplates[key].subject || "",
      body:    obj.emailTemplates[key].body    || "",
    };
  } catch {
    return null;
  }
}

function _substitute(s: string, vars: Record<string, string>): string {
  return (s || "").replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key] ?? "") : m));
}

function buildEmailBody(firstName: string, items: DigestItem[], hubUrl: string) {
  const lines: string[] = [];
  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push("Here's what's on your plate today.");
  lines.push("");

  const sessions = items.filter(i => i.kind === "session");
  const commitFollow = items.filter(i => i.kind === "commit-followup");
  const dueToday = items.filter(i => i.kind === "task-due");
  const overdue = items.filter(i => i.kind === "task-overdue");
  const checkin = items.filter(i => i.kind === "checkin");

  if (commitFollow.length) {
    lines.push("── FROM YESTERDAY ──");
    commitFollow.forEach(i => {
      lines.push(`• ${i.text}`);
      if (i.link) lines.push(`  → ${i.meta}: ${i.link}`);
    });
    lines.push("");
  }
  if (sessions.length) {
    lines.push("── SESSIONS THIS WEEK ──");
    sessions.forEach(i => {
      lines.push(`📅 ${i.text}`);
      if (i.meta) lines.push(`   ${i.meta}`);
    });
    lines.push("");
  }
  if (dueToday.length) {
    lines.push("── DUE TODAY ──");
    dueToday.forEach(i => {
      lines.push(`☐ ${i.text}`);
      if (i.link) lines.push(`  → ${i.meta}: ${i.link}`);
    });
    lines.push("");
  }
  if (overdue.length) {
    lines.push("── OVERDUE ──");
    overdue.forEach(i => {
      lines.push(`☐ ${i.text}`);
      if (i.link) lines.push(`  → ${i.meta}: ${i.link}`);
    });
    lines.push("");
  }
  if (checkin.length) {
    lines.push("── WEEKLY CHECK-IN ──");
    checkin.forEach(i => {
      lines.push(`${i.text}`);
      if (i.link) lines.push(`→ ${i.link}`);
    });
    lines.push("");
  }

  // v11745: Friday reflection — what blocked you on the unfinished tasks
  const friBlocked = items.filter(i => i.kind === "fri-unfinished");
  if (friBlocked.length) {
    lines.push("── DIDN'T GET DONE THIS WEEK ──");
    lines.push("These were on your plate but didn't get ticked off. Honest answers help — Phoebe will work them into next week's plan.");
    lines.push("");
    friBlocked.forEach(i => {
      lines.push(`☐ ${i.text}`);
      if (i.link) lines.push(`  → ${i.meta}: ${i.link}`);
    });
    lines.push("");
  }

  lines.push("YOUR HUB");
  lines.push(hubUrl);
  lines.push("");
  lines.push("Small moves, big consequences.");
  lines.push("");
  lines.push("Phoebe x");
  return lines.join("\n");
}

export default async (req: Request) => {
  const secret = Netlify.env.get("QUICK_ACTION_SECRET");
  const base = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
  if (!secret) {
    console.error("[daily-digest] QUICK_ACTION_SECRET missing — emails would have unsafe links");
    return new Response(JSON.stringify({ error: "QUICK_ACTION_SECRET not configured" }), { status: 503 });
  }

  const now = new Date();
  const todayStr = todayKey(now);

  // v11745: bi-weekly cadence — only run on Monday + Friday in AEST.
  // Manual HTTP triggers (POST /api/daily-digest from coach UI) bypass
  // this gate via ?force=1 so Phoebe can preview/send ad hoc.
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && !isMonday(now) && !isFriday(now)) {
    return new Response(JSON.stringify({ skipped: true, reason: "not Mon/Fri in AEST", todayStr }), { status: 200 });
  }

  const clientsStore = getStore("clients");
  const remindersStore = getStore("reminders");

  // Iterate the blob store for clients (Netlify Blobs list API)
  const list = await clientsStore.list();
  let sent = 0, skipped = 0, errors = 0;

  for (const blob of list.blobs) {
    try {
      const raw = await clientsStore.get(blob.key);
      if (!raw) { skipped++; continue; }
      const client = JSON.parse(raw);
      if (!client || !client.email) { skipped++; continue; }
      if (client.notificationsDisabled) { skipped++; continue; }
      if (client.archived || client.status === "complete") { skipped++; continue; }

      // Dedupe — already sent today?
      const dedupeKey = `digest::${client.id}::${todayStr}`;
      const already = await remindersStore.get(dedupeKey);
      if (already) { skipped++; continue; }

      const items = buildDigestForClient(client, secret, base, now);
      if (!items.length) { skipped++; continue; }

      const firstName = (client.name || "").split(" ")[0] || "there";
      const hubUrl = `${base}/?client=${encodeURIComponent(client.clientAccess || "")}`;
      const innerBody = buildEmailBody(firstName, items, hubUrl);

      // v11746: render via Phoebe-editable template if she's saved one.
      // The digest-* templates use {digestBody} as the dynamic middle
      // section; everything else is her wording.
      const templateKey = isFriday(now) ? "digestFri" : "digestMon";
      const tpl = await _readEmailTemplate(templateKey);
      const vars = {
        firstName,
        name: firstName,
        clientName: client.name || firstName,
        hubUrl,
        accessCode: client.clientAccess || "",
        digestBody: innerBody.replace(/^Hi [^\n]+,\n*/i, "").replace(/\n\nPhoebe x\s*$/i, "").trim(),
      };
      // Subject — keep it personal + count-aware
      const counts: string[] = [];
      if (items.some(i => i.kind === "task-due" || i.kind === "task-overdue")) counts.push(`${items.filter(i => i.kind === "task-due" || i.kind === "task-overdue").length} task${items.filter(i => i.kind === "task-due" || i.kind === "task-overdue").length === 1 ? "" : "s"}`);
      if (items.some(i => i.kind === "session")) counts.push("session");
      if (items.some(i => i.kind === "checkin")) counts.push("check-in");
      const defaultSubject = counts.length
        ? `Today on your hub — ${counts.join(", ")}`
        : "Today on your hub";

      const subject = tpl ? _substitute(tpl.subject, vars) : defaultSubject;
      const body    = tpl ? _substitute(tpl.body, vars)    : innerBody;

      const sendResp = await fetch(`${base}/api/send-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email",
          to: client.email,
          subject,
          message: body,
          clientName: client.name,
        }),
      });
      if (sendResp.ok) {
        await remindersStore.set(dedupeKey, JSON.stringify({ at: new Date().toISOString(), itemCount: items.length }));
        sent++;
      } else {
        errors++;
        console.error(`[daily-digest] send failed for ${client.id}: ${sendResp.status}`);
      }
    } catch (err: any) {
      errors++;
      console.error(`[daily-digest] error on ${blob.key}: ${err?.message || err}`);
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, skipped, errors, todayStr }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// HTTP endpoint for manual triggering (Phoebe can hit /api/daily-digest to fire now)
export const config: Config = {
  path: "/api/daily-digest",
};
