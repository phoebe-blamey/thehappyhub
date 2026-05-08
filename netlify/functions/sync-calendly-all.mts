import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// POST /api/sync-calendly-all
// Pulls EVERY Calendly event from the user's account in the last `days` days
// (default 365), walks all invitees, and creates/updates clients in Blobs.
//
// Returns: { processed, created, updated, skipped, errors, sample }
//
// Heuristics:
//   - Match existing clients by lowercase email
//   - For matched clients, ensure a program exists for the event type with
//     a sessionDate matching the event's start_time. If none, append.
//   - For unmatched, create a new client record with the program.
//   - Event type → program mapping uses keywords in the event name.

const PROGRAM_FROM_EVENT_NAME = (name: string): { program: string; label: string; workbook: string } => {
  const n = (name || "").toLowerCase();
  if (n.includes("mdc") || n.includes("million dollar")) return { program: "mdc", label: "Million Dollar Conspiracy", workbook: "mdc" };
  if (n.includes("happy hour")) return { program: "happyhour", label: "Happy Hour", workbook: "happyhour" };
  if (n.includes("audit") || n.includes("breakthrough"))   return { program: "audit", label: "Beautiful Business Audit", workbook: "audit" };
  if (n.includes("90") || n.includes("business builder")) return { program: "90day", label: "90-Day Business Builder", workbook: "90day" };
  if (n.includes("clarity") || n.includes("discovery"))    return { program: "inquiry", label: "Discovery Call", workbook: "inquiry" };
  if (n.includes("podcast")) return { program: "podcast", label: "Podcast Recording", workbook: "none" };
  if (n.includes("partner")) return { program: "partner", label: "Partner Meeting", workbook: "none" };
  if (n.includes("research")) return { program: "research", label: "Research Chat", workbook: "none" };
  // Default: an ad-hoc coaching session
  return { program: "adhoc", label: "Ad Hoc Coaching", workbook: "session" };
};

function generateAccessCode(name: string): string {
  const initials = (name || "").split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  const num = Math.floor(Math.random() * 90 + 10); // 10-99
  return (initials || "HH") + num;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const token = Netlify.env.get("CALENDLY_API_TOKEN");
  if (!token) return new Response(JSON.stringify({ error: "CALENDLY_API_TOKEN not configured" }), { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const days: number = Math.min(Math.max(body.days || 365, 30), 730);
  const dryRun: boolean = !!body.dryRun;

  const auth = `Bearer ${token}`;

  // 1. Resolve current user URI
  const meResp = await fetch("https://api.calendly.com/users/me", { headers: { Authorization: auth } });
  if (!meResp.ok) return new Response(JSON.stringify({ error: "Calendly auth failed", status: meResp.status }), { status: 502 });
  const me = await meResp.json();
  const userUri: string = me.resource.uri;

  // 2. List all scheduled events for that user in the date window. Walk pagination.
  const minDate = new Date(); minDate.setDate(minDate.getDate() - days);
  const events: any[] = [];
  let nextUrl: string | null = `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${minDate.toISOString()}&count=100&sort=start_time:desc`;
  let pages = 0;
  while (nextUrl && pages < 20) { // safety cap (max 2000 events)
    const r: Response = await fetch(nextUrl, { headers: { Authorization: auth } });
    if (!r.ok) break;
    const j: any = await r.json();
    if (Array.isArray(j.collection)) events.push(...j.collection);
    nextUrl = j.pagination?.next_page || null;
    pages++;
  }

  // 3. For each event, fetch its invitees and process
  const store = getStore("clients");
  const list = await store.list();
  const byEmail: Record<string, any> = {};
  for (const blob of list.blobs) {
    if (!blob.key) continue;
    const raw = await store.get(blob.key);
    if (!raw) continue;
    try {
      const c = JSON.parse(raw);
      if (c && c.email) byEmail[String(c.email).toLowerCase().trim()] = c;
    } catch {}
  }

  const stats = { processed: 0, created: 0, updated: 0, skippedNoEmail: 0, skippedExisting: 0, errors: 0 };
  const sample: Array<{ kind: "created" | "updated" | "skipped"; name: string; email: string; reason?: string }> = [];

  for (const ev of events) {
    stats.processed++;
    try {
      const inviteesResp = await fetch(`${ev.uri}/invitees`, { headers: { Authorization: auth } });
      if (!inviteesResp.ok) { stats.errors++; continue; }
      const inviteesJ = await inviteesResp.json();
      const invitees: any[] = inviteesJ.collection || [];
      for (const inv of invitees) {
        const email: string = (inv.email || "").toLowerCase().trim();
        const name:  string = (inv.name  || "").trim();
        if (!email) { stats.skippedNoEmail++; continue; }
        const evName: string = ev.name || "";
        const startTime: string = ev.start_time || "";
        const sessionDate = startTime ? startTime.split("T")[0] : new Date().toISOString().split("T")[0];
        const meta = PROGRAM_FROM_EVENT_NAME(evName);

        const existing = byEmail[email];
        if (existing) {
          // Update path: ensure a matching program exists. Match by program + sessionDate.
          existing.programs = existing.programs || [];
          const dup = existing.programs.find((p: any) =>
            p.program === meta.program && p.sessionDate === sessionDate);
          if (dup) {
            stats.skippedExisting++;
            continue;
          }
          const newProg: any = {
            id: `prog-${meta.program}-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
            program: meta.program,
            label: meta.label,
            workbook: meta.workbook,
            sessionDate,
            status: "active",
            locked: false,
            intake: `Auto-imported from Calendly · ${evName}`,
            notes: { themes:"", leaks:"", opps:"", patterns:"", private:"", research:"" },
            plan: [], taskDone: {}, sessionNotes: [], wins: [],
            createdAt: new Date().toISOString(),
            source: "calendly-sync"
          };
          if (meta.workbook === "mdc") newProg.mdcWorkbook = { businessSnapshot:"", vision:"", meNow:"", sprintFocus:"", weeklyCheckins:{} };
          if (meta.workbook === "happyhour") newProg.happyHour = { assets:"", discussed:"", actions:"", resources:"" };
          existing.programs.push(newProg);
          existing.updatedAt = new Date().toISOString();
          if (!dryRun) await store.set(existing.id, JSON.stringify(existing));
          stats.updated++;
          sample.push({ kind: "updated", name: existing.name, email, reason: `+${meta.label} · ${sessionDate}` });
        } else {
          // Create path
          const id = `client-cal-${email.replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;
          const newProg: any = {
            id: `prog-${meta.program}-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
            program: meta.program,
            label: meta.label,
            workbook: meta.workbook,
            sessionDate,
            status: "active",
            locked: false,
            intake: `Auto-imported from Calendly · ${evName}`,
            notes: { themes:"", leaks:"", opps:"", patterns:"", private:"", research:"" },
            plan: [], taskDone: {}, sessionNotes: [], wins: [],
            createdAt: new Date().toISOString(),
            source: "calendly-sync"
          };
          if (meta.workbook === "mdc") newProg.mdcWorkbook = { businessSnapshot:"", vision:"", meNow:"", sprintFocus:"", weeklyCheckins:{} };
          if (meta.workbook === "happyhour") newProg.happyHour = { assets:"", discussed:"", actions:"", resources:"" };
          const record: any = {
            id,
            name: name || email.split("@")[0],
            email,
            phone: inv.text_reminder_number || "",
            biz: "",
            clientAccess: generateAccessCode(name || email),
            status: "active",
            health: "green",
            socials: { website:"", linkedin:"", instagram:"", whatsapp:"" },
            programs: [newProg],
            tasks: [],
            coachNotes: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "calendly-sync"
          };
          // Pull name/business from question_and_answers if available
          const qas: any[] = inv.questions_and_answers || [];
          for (const q of qas) {
            const qText = (q.question || "").toLowerCase();
            const a = q.answer || "";
            if (!a) continue;
            if (qText.includes("business name") || qText.includes("business")) record.biz = record.biz || a;
            if (qText.includes("phone")) record.phone = record.phone || a;
            if (qText.includes("website")) record.programs[0].websiteUrl = a;
          }
          if (!dryRun) {
            await store.set(record.id, JSON.stringify(record));
            byEmail[email] = record;
          }
          stats.created++;
          sample.push({ kind: "created", name: record.name, email, reason: `${meta.label} · ${sessionDate}` });
        }
      }
    } catch (err: any) {
      stats.errors++;
      console.error("[sync-calendly-all] event error", err?.message);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    dryRun,
    days,
    eventsScanned: events.length,
    stats,
    sample: sample.slice(0, 30)
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/sync-calendly-all" };
