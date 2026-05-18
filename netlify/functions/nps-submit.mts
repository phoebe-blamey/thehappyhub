import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireClientAuth } from "./_auth.mts";

// ════════════════════════════════════════════════════════════════════
// v11763 — NPS survey submission endpoint
// ════════════════════════════════════════════════════════════════════
// Three NPS touchpoints across a paid program:
//   1. "post-session" — 24h after the first 1-on-1 (delivery check-in)
//   2. "midway"      — ~week 6 of a 12-week plan
//   3. "final"       — ~week 12 / program complete
//
// Single question: "How likely are you to recommend us to a friend?" (0-10).
//
// Score-based follow-up paths:
//   9-10 → LinkedIn review link (raving fan, harvest social proof)
//   6-8  → "Book a call with Phoebe to rework it" (silent attrition risk)
//   <6   → open feedback textarea (root-cause + email Phoebe direct)
//
// POST /api/nps-submit
// Headers: x-client-access = <their access code>
// Body:    { clientId, npsId, score, followup?, followupAction? }
//   - npsId          : id of the entry on client.nps[] being responded to
//   - score          : 0-10
//   - followup       : their freeform follow-up (for <6 path mainly)
//   - followupAction : 'linkedin' | 'book-call' | 'feedback' | null
//
// Returns the updated client record.

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const clientId = (body.clientId || "").toString();
  const npsId = (body.npsId || "").toString();
  const score = parseInt(body.score, 10);
  const followup = (body.followup || "").toString().slice(0, 2000);
  const followupAction = ["linkedin", "book-call", "feedback"].indexOf(body.followupAction) >= 0
    ? body.followupAction
    : null;

  if (!clientId || !npsId) {
    return new Response(JSON.stringify({ error: "clientId and npsId required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    return new Response(JSON.stringify({ error: "score must be 0-10" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const store = getStore("clients");
  const raw = await store.get(clientId);
  if (!raw) {
    return new Response(JSON.stringify({ error: "Client not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  let client: any;
  try { client = JSON.parse(raw); } catch {
    return new Response(JSON.stringify({ error: "Corrupt record" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Auth — must match the stored access code on this client record
  const unauth = requireClientAuth(req, client.clientAccess);
  if (unauth) return unauth;

  // Find the NPS entry being responded to (must exist, must not be already responded)
  client.nps = Array.isArray(client.nps) ? client.nps : [];
  const entry = client.nps.find((n: any) => n && n.id === npsId);
  if (!entry) {
    return new Response(JSON.stringify({ error: "NPS entry not found on client" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  if (entry.respondedAt) {
    return new Response(JSON.stringify({ error: "Already responded", entry }), { status: 409, headers: { "Content-Type": "application/json" } });
  }

  // Record the response
  entry.score = score;
  entry.followup = followup;
  entry.followupAction = followupAction;
  entry.respondedAt = new Date().toISOString();
  client.updatedAt = new Date().toISOString();

  try {
    await store.set(clientId, JSON.stringify(client));
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to save: " + String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Activity log so Phoebe sees the NPS on her Pulse panel
  try {
    const activityStore = getStore("activity-log");
    const logRaw = await activityStore.get("main");
    const log = logRaw ? JSON.parse(logRaw) : [];
    const cat = score >= 9 ? "🎉 Promoter" : score >= 7 ? "🟡 Passive" : "⚠ Detractor";
    log.unshift({
      id: "act-nps-" + Date.now(),
      kind: "nps",
      title: `${cat} · ${client.name || "Client"} scored ${score}/10`,
      body: (followup ? `"${followup.slice(0, 200)}"` : "(no comment)") + " — " + entry.type + (entry.programLabel ? " · " + entry.programLabel : ""),
      ref: { clientId, npsId, score },
      ts: new Date().toISOString(),
    });
    await activityStore.set("main", JSON.stringify(log.slice(0, 500)));
  } catch (err) {
    console.error("[nps-submit] activity log push failed:", err);
  }

  // Email Phoebe directly when score <= 6 (detractor — needs personal follow-up)
  if (score <= 6) {
    try {
      const base = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
      const phoebeEmail = Netlify.env.get("GOOGLE_SENDER_EMAIL") || "phoebe@phoebeblamey.com.au";
      const emailBody =
        `${client.name || "A client"} just submitted an NPS score of ${score}/10.\n\n` +
        `Survey: ${entry.type}${entry.programLabel ? " · " + entry.programLabel : ""}\n` +
        `When: ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}\n\n` +
        (followup ? `What they said:\n"${followup}"\n\n` : "(They didn't add a comment.)\n\n") +
        `Open their hub: ${base}/?coach\n\n` +
        `— sent automatically by the Happy Hub`;
      await fetch(`${base}/api/send-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": Netlify.env.get("INTERNAL_CRON_SECRET") || "",
        },
        body: JSON.stringify({
          type: "email",
          to: phoebeEmail,
          subject: `⚠ Detractor NPS · ${client.name || "Client"} scored ${score}/10`,
          message: emailBody,
          clientName: "Coach inbox",
          // Bypass the comms killswitch for this alert — Phoebe needs to know
          force: true,
        }),
      });
    } catch (err) {
      console.error("[nps-submit] detractor email failed:", err);
    }
  }

  return new Response(JSON.stringify({ ok: true, client }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/nps-submit" };
