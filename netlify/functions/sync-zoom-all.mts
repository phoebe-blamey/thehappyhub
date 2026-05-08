import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// POST /api/sync-zoom-all
// Walks ALL Zoom cloud recordings (paginated) for the past `days` days,
// matches them to existing clients by name-in-topic + date proximity, and
// optionally creates stub client records for any that can't be matched.
//
// Body: { days?: number (default 365, max 730), createUnmatched?: bool, dryRun?: bool }
//
// Returns: { stats, matched, unmatched, sample }
//
// "createUnmatched" creates a stub client record from the Zoom topic + date.
// The stub gets a generic "session" program, a generated access code, and
// is flagged source: "zoom-sync" so Phoebe can recognise / clean up later.

function parseClientNameFromTopic(topic: string): string {
  // "Phoebe <> Sarah Chen" / "Phoebe & Sarah Chen" / "Phoebe and Sarah" /
  // "Discovery Call - Sarah Chen" — extract the non-Phoebe part.
  if (!topic) return "";
  let t = topic.replace(/[‒–—-]+/g, "-").trim();
  // Strip common prefixes
  t = t.replace(/^(zoom meeting|meeting|call|chat|session|discovery call|business audit|happy hour|mdc|million dollar conspiracy|90.day.+?|breakthrough)\s*[-:]?\s*/i, "");
  // Split on common separators
  let parts = t.split(/\s*(?:<>|&|\+|with|and|\/|\|)\s*/i).map(s => s.trim()).filter(Boolean);
  // Remove "Phoebe" / "Phoebe Blamey" / "Pheobe" parts
  parts = parts.filter(p => !/^p(h|hh)?o?ebe(\s+blamey)?$/i.test(p));
  // Take the first remaining part — that's likely the client name
  return parts[0] || t;
}

function generateAccessCode(name: string): string {
  const initials = (name || "").split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  const num = Math.floor(Math.random() * 90 + 10);
  return (initials || "HH") + num;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const accountId    = Netlify.env.get("ZOOM_ACCOUNT_ID");
  const clientId     = Netlify.env.get("ZOOM_CLIENT_ID");
  const clientSecret = Netlify.env.get("ZOOM_CLIENT_SECRET");
  if (!accountId || !clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "Zoom credentials not configured" }), { status: 503 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const days: number = Math.min(Math.max(body.days || 365, 30), 730);
  const createUnmatched: boolean = body.createUnmatched !== false; // default true
  const dryRun: boolean = !!body.dryRun;

  // ── 1. Get a Zoom access token via Server-to-Server OAuth ──
  let accessToken = "";
  try {
    const tokenResp = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
          "Content-Type":  "application/x-www-form-urlencoded",
        },
      }
    );
    const tokenData = await tokenResp.json();
    accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("No access token: " + JSON.stringify(tokenData).slice(0, 200));
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Zoom auth failed: " + String(err?.message || err) }), { status: 502 });
  }

  // ── 2. Walk recordings in chunks. Zoom's API limits each query to ~30 days,
  //      so we step through the window in 30-day slices and accumulate. ──
  const recordings: any[] = [];
  const today = new Date();
  let cursor = new Date(today.getTime() - days * 86400000);
  while (cursor < today) {
    const sliceEnd = new Date(Math.min(cursor.getTime() + 30 * 86400000, today.getTime()));
    const fromStr = cursor.toISOString().split("T")[0];
    const toStr   = sliceEnd.toISOString().split("T")[0];
    let nextToken = "";
    let pages = 0;
    do {
      const url = new URL("https://api.zoom.us/v2/users/me/recordings");
      url.searchParams.set("from", fromStr);
      url.searchParams.set("to",   toStr);
      url.searchParams.set("page_size", "100");
      if (nextToken) url.searchParams.set("next_page_token", nextToken);
      const r: Response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) break;
      const j: any = await r.json();
      if (Array.isArray(j.meetings)) recordings.push(...j.meetings);
      nextToken = j.next_page_token || "";
      pages++;
    } while (nextToken && pages < 6);
    cursor = sliceEnd;
  }

  // ── 3. Load existing clients into memory for matching ──
  const store = getStore("clients");
  const list = await store.list();
  const all: any[] = [];
  for (const blob of list.blobs) {
    if (!blob.key) continue;
    const raw = await store.get(blob.key);
    if (!raw) continue;
    try { all.push(JSON.parse(raw)); } catch {}
  }

  const stats = { recordings: recordings.length, matched: 0, alreadyAttached: 0, created: 0, unmatchedSkipped: 0, errors: 0 };
  const sample: Array<{ kind: string; topic: string; date: string; clientName?: string; meetingId?: string; reason?: string }> = [];

  for (const rec of recordings) {
    try {
      const topic: string = rec.topic || "";
      const startTime: string = rec.start_time || "";
      const recId: string = String(rec.id || rec.uuid || "");
      const sessionDate = startTime ? startTime.split("T")[0] : "";

      // Skip recordings with no actual recording_files (in-progress, zero-duration, etc.)
      const hasFiles = Array.isArray(rec.recording_files) && rec.recording_files.length > 0;
      if (!hasFiles) {
        stats.unmatchedSkipped++;
        continue;
      }

      // Match by date (±1 day) + first-name in topic
      const recT = startTime ? new Date(startTime).getTime() : 0;
      const candidate = all.find((c: any) => {
        const firstName = (c.name || "").split(" ")[0];
        if (!firstName || !topic.toLowerCase().includes(firstName.toLowerCase())) return false;
        return (c.programs || []).some((p: any) => {
          if (!p.sessionDate) return false;
          const sd = new Date(p.sessionDate).getTime();
          return Math.abs(recT - sd) <= 86400000;
        });
      });

      // Extract richer recording metadata once — used by both match + create paths
      const recDuration: number = rec.duration || 0;
      const recHostEmail: string = rec.host_email || "";
      const recPlayUrl: string = rec.share_url || "";
      const recPasscode: string = rec.recording_play_passcode || "";
      // Pull file URLs for the playable formats so Phoebe can link out from a
      // session note without leaving the platform.
      const playFiles = (rec.recording_files || []).filter((f: any) =>
        f.file_type === "MP4" || f.file_type === "M4A" || f.file_type === "TRANSCRIPT" || f.file_type === "CC");
      const recVideoFile = playFiles.find((f: any) => f.file_type === "MP4");
      const recVideoUrl: string = recVideoFile?.play_url || recVideoFile?.download_url || "";
      const recHasTranscript: boolean = playFiles.some((f: any) => f.file_type === "TRANSCRIPT" || f.recording_type === "audio_transcript");

      if (candidate) {
        stats.matched++;
        const targetProg = (candidate.programs || []).find((p: any) => {
          if (!p.sessionDate) return false;
          const sd = new Date(p.sessionDate).getTime();
          return Math.abs(recT - sd) <= 86400000;
        });
        if (targetProg) {
          targetProg.sessionNotes = targetProg.sessionNotes || [];
          // Avoid duplicates — skip if a session note already references this Zoom meeting
          const dup = targetProg.sessionNotes.some((n: any) => n.zoomMeetingId === recId);
          if (dup) {
            stats.alreadyAttached++;
          } else {
            targetProg.sessionNotes.push({
              id: `sn-zoomsync-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
              date: sessionDate,
              text: `[Zoom: ${topic}] — ${recDuration ? recDuration + ' min · ' : ''}auto-attached by sync`,
              sharedWithClient: false,
              zoomMeetingId: recId,
              zoomTopic: topic,
              zoomUrl: recPlayUrl,
              zoomVideoUrl: recVideoUrl,
              zoomPasscode: recPasscode,
              zoomDuration: recDuration,
              hasTranscript: recHasTranscript,
              createdAt: new Date().toISOString(),
            });
            // Also pin the Zoom join URL on the program if not yet set
            if (!targetProg.zoomJoin && recPlayUrl) targetProg.zoomJoin = recPlayUrl;
            candidate.updatedAt = new Date().toISOString();
            if (!dryRun) await store.set(candidate.id, JSON.stringify(candidate));
            sample.push({ kind: "matched-attached", topic, date: sessionDate, clientName: candidate.name });
          }
        }
      } else if (createUnmatched) {
        // Create a stub client record from the topic
        const guessedName = parseClientNameFromTopic(topic) || "Unknown contact";
        // Skip recordings that look like internal/non-client meetings
        const skipPatterns = /^(team|internal|standup|stand-up|sync|all hands|admin|test|practice run)/i;
        if (skipPatterns.test(guessedName) || skipPatterns.test(topic)) {
          stats.unmatchedSkipped++;
          sample.push({ kind: "unmatched-skipped", topic, date: sessionDate, reason: "looks like internal" });
          continue;
        }
        const id = `client-zoom-${guessedName.toLowerCase().replace(/[^a-z0-9]/g,'-').slice(0,40)}-${Date.now()}`;
        const stub: any = {
          id,
          name: guessedName,
          email: "",
          phone: "",
          biz: "",
          clientAccess: generateAccessCode(guessedName),
          status: "active",
          health: "green",
          socials: { website:"", linkedin:"", instagram:"", whatsapp:"" },
          programs: [{
            id: `prog-zoom-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
            program: "coaching",
            label: "Coaching",
            workbook: "90day",
            sessionDate,
            status: "active",
            locked: false,
            intake: `Auto-created from Zoom recording · ${topic}\nDuration: ${recDuration} minutes\nHost: ${recHostEmail}`,
            zoomJoin: recPlayUrl,
            notes: { themes:"", leaks:"", opps:"", patterns:"", private:"Created from Zoom — no email or contact details captured. Phoebe to enrich.", research:"" },
            plan: [], taskDone: {}, wins: [],
            sessionNotes: [{
              id: `sn-zoom-${Date.now()}`,
              date: sessionDate,
              text: `[Zoom: ${topic}] — ${recDuration ? recDuration + ' min · ' : ''}auto-imported by sync`,
              sharedWithClient: false,
              zoomMeetingId: recId,
              zoomTopic: topic,
              zoomUrl: recPlayUrl,
              zoomVideoUrl: recVideoUrl,
              zoomPasscode: recPasscode,
              zoomDuration: recDuration,
              hasTranscript: recHasTranscript,
              createdAt: new Date().toISOString(),
            }],
            createdAt: new Date().toISOString(),
            source: "zoom-sync"
          }],
          tasks: [],
          coachNotes: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: "zoom-sync"
        };
        if (!dryRun) {
          await store.set(id, JSON.stringify(stub));
          all.push(stub);
        }
        stats.created++;
        sample.push({ kind: "created", topic, date: sessionDate, clientName: guessedName });
      } else {
        stats.unmatchedSkipped++;
        sample.push({ kind: "unmatched-skipped", topic, date: sessionDate });
      }
    } catch (err: any) {
      stats.errors++;
      console.error("[sync-zoom-all] recording error", err?.message);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    dryRun,
    days,
    createUnmatched,
    stats,
    sample: sample.slice(0, 50)
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/sync-zoom-all" };
