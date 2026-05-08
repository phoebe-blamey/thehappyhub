import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Scheduled every 10 minutes (see netlify.toml `[functions."send-reminders"]`).
// Walks every client's programs, finds upcoming session datetimes, and sends
// a reminder email at three tiers: 24 hours before, 1 hour before, and
// 10 minutes before. Sent reminders are tracked in a separate "reminders"
// blob store so we never double-send if the schedule overlaps.
//
// Each reminder email points the client at:
//   1. Their hub portal (with their access code pre-filled in the URL)
//   2. The Zoom join URL pinned on the program (when present)
//   3. The session date/time (Australia/Sydney friendly format)
//
// Phoebe wanted this primarily for MDC sessions but we apply it to any
// paid program with a sessionDate. Discovery / inquiry / podcast / partner
// programs are skipped — they have their own Calendly notifications.

interface Tier {
  key: string;
  minutesBefore: number;
  windowMinutes: number; // tolerance — schedule fires every 10min, so 6min window catches each tier exactly once
  label: string;
}
const TIERS: Tier[] = [
  { key: "1d",  minutesBefore: 24 * 60, windowMinutes: 11, label: "tomorrow"      },
  { key: "1h",  minutesBefore: 60,      windowMinutes: 11, label: "in an hour"    },
  { key: "10m", minutesBefore: 10,      windowMinutes: 11, label: "in 10 minutes" },
];

// Skip these — Calendly already sends its own reminders for free intro calls
const SKIP_PROGRAMS = new Set(["inquiry", "mdc-inquiry", "podcast", "partner", "research", "general"]);

function formatSessionTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "long",
      day:     "numeric",
      month:   "long",
      hour:    "numeric",
      minute:  "2-digit",
      hour12:  true,
    });
  } catch {
    return iso;
  }
}

function buildReminderEmail(args: {
  firstName: string;
  programLabel: string;
  sessionTime: string;
  tierLabel: string;
  zoomUrl: string;
  hubUrl: string;
  hubCode: string;
}): { subject: string; body: string } {
  const { firstName, programLabel, sessionTime, tierLabel, zoomUrl, hubUrl, hubCode } = args;
  const subject = `Reminder: ${programLabel} ${tierLabel}`;
  const lines: string[] = [
    `Hi ${firstName},`,
    "",
    `Quick reminder — your ${programLabel} is ${tierLabel}.`,
    "",
    `When: ${sessionTime}`,
  ];
  if (zoomUrl) {
    lines.push(`Zoom:  ${zoomUrl}`);
  }
  lines.push("");
  lines.push("YOUR HUB");
  lines.push(`${hubUrl}`);
  lines.push(`Code: ${hubCode}`);
  lines.push("");
  if (tierLabel === "tomorrow") {
    lines.push("Have a quick look at your portal beforehand — it's where your plan, tasks and notes live.");
  } else if (tierLabel === "in an hour") {
    lines.push("Grab a cuppa, find a quiet spot. See you soon.");
  } else {
    lines.push("Almost go-time — see you on Zoom shortly!");
  }
  lines.push("");
  lines.push("Phoebe x");
  return { subject, body: lines.join("\n") };
}

export default async (req: Request) => {
  const baseUrl = new URL(req.url).origin;
  const clients = getStore("clients");
  const reminders = getStore("reminders");
  const now = Date.now();

  const stats = { scanned: 0, eligible: 0, sent: 0, skippedAlready: 0, errors: 0 };
  const log: string[] = [];

  let cursor: string | undefined;
  do {
    const list = await clients.list({ cursor });
    cursor = list.cursor;
    for (const blob of list.blobs) {
      if (!blob.key) continue;
      stats.scanned++;
      const raw = await clients.get(blob.key);
      if (!raw) continue;
      let client: any;
      try { client = JSON.parse(raw); } catch { continue; }
      if (!client.email || !client.clientAccess) continue;
      if (client.archived) continue; // archived clients don't get reminders
      const firstName = String(client.name || "there").split(" ")[0] || "there";
      for (const prog of client.programs || []) {
        if (!prog.sessionDate) continue;
        if (SKIP_PROGRAMS.has(prog.program)) continue;
        if (prog.status === "complete" || prog.locked) continue;
        const sessionMs = new Date(prog.sessionDate).getTime();
        if (!Number.isFinite(sessionMs) || sessionMs < now) continue; // already happened
        const minutesUntil = (sessionMs - now) / 60000;
        for (const tier of TIERS) {
          // Hit the tier when we're within `windowMinutes` AFTER crossing the
          // (sessionTime - minutesBefore) boundary. Catches each tier once
          // assuming the schedule is faster than the window length.
          const diff = Math.abs(minutesUntil - tier.minutesBefore);
          if (diff > tier.windowMinutes) continue;
          stats.eligible++;
          const dedupeKey = `${client.id}|${prog.id}|${prog.sessionDate}|${tier.key}`;
          // Reminders store keys must be filename-safe (Netlify Blobs is strict)
          const safeKey = dedupeKey.replace(/[^a-zA-Z0-9._-]/g, "_");
          const already = await reminders.get(safeKey);
          if (already) { stats.skippedAlready++; continue; }
          // Build + send
          const programLabel = prog.label || prog.program || "session";
          const sessionTime = formatSessionTime(prog.sessionDate);
          const hubUrl = `${baseUrl}/?client=${client.clientAccess}`;
          const zoomUrl = prog.zoomJoin || "";
          const { subject, body } = buildReminderEmail({
            firstName, programLabel, sessionTime, tierLabel: tier.label, zoomUrl,
            hubUrl, hubCode: client.clientAccess,
          });
          try {
            const resp = await fetch(`${baseUrl}/api/send-message`, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ type: "email", to: client.email, subject, message: body, clientName: client.name }),
            });
            if (resp.ok) {
              stats.sent++;
              await reminders.set(safeKey, JSON.stringify({ sentAt: new Date().toISOString(), tier: tier.key, clientId: client.id, progId: prog.id }));
              log.push(`✓ ${tier.key} → ${client.email} · ${programLabel}`);
            } else {
              stats.errors++;
              log.push(`✗ ${tier.key} → ${client.email} · ${resp.status}`);
            }
          } catch (err: any) {
            stats.errors++;
            log.push(`✗ ${tier.key} → ${client.email} · ${err?.message || err}`);
          }
        }
      }
    }
  } while (cursor);

  return new Response(JSON.stringify({ stats, log }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// Run every 10 minutes. The 11-minute window per tier means each client
// hits each tier exactly once across runs.
export const config: Config = {
  path: "/api/send-reminders",
  schedule: "*/10 * * * *",
};
