import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { createHmac } from "crypto";

// ════════════════════════════════════════════════════════════════════
// v11743 — ONE-TAP COMPLETION from email
// ════════════════════════════════════════════════════════════════════
// Clients hit a signed URL embedded in their daily digest email to
// complete a task / mark a commit done / submit RSVP, WITHOUT having
// to sign into the hub. Reduces the click-cost from "open email →
// click hub link → log in → find task → click → confirm" to ONE TAP.
//
// URL shape:
//   /api/quick-action?t=<token>&a=<action>&c=<clientId>&i=<itemId>
//
// Where:
//   token  = HMAC-SHA256(action + clientId + itemId + day-of-year)
//            signed with QUICK_ACTION_SECRET env var
//   action = "task-done" | "commit-done" | "checkin-now"
//   c      = client.id
//   i      = task id / iso date / etc.
//
// Tokens are valid for ~36 hours (signed with day-of-year, accepts
// today OR yesterday's signature so a link sent at 8pm yesterday
// still works at 8am today).
//
// Returns a friendly HTML page confirming the action.
// ════════════════════════════════════════════════════════════════════

const ALLOWED_ACTIONS = new Set(["task-done", "commit-done", "checkin-now"]);

function dayKey(d: Date) {
  // YYYY-MM-DD in UTC — stable across function invocations within a day
  return d.toISOString().slice(0, 10);
}
function yesterdayKey(d: Date) {
  const y = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return dayKey(y);
}

function sign(action: string, clientId: string, itemId: string, day: string, secret: string) {
  const payload = `${action}|${clientId}|${itemId}|${day}`;
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 24);
}

function verifyToken(token: string, action: string, clientId: string, itemId: string, secret: string) {
  const now = new Date();
  const candidates = [dayKey(now), yesterdayKey(now)];
  for (const day of candidates) {
    const expected = sign(action, clientId, itemId, day, secret);
    if (expected === token) return true;
  }
  return false;
}

// Public — used by daily-digest to build the email links
export function buildQuickActionUrl(base: string, action: string, clientId: string, itemId: string, secret: string) {
  const day = dayKey(new Date());
  const token = sign(action, clientId, itemId, day, secret);
  const baseTrim = (base || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
  return `${baseTrim}/api/quick-action?t=${token}&a=${encodeURIComponent(action)}&c=${encodeURIComponent(clientId)}&i=${encodeURIComponent(itemId)}`;
}

function htmlPage(title: string, body: string, hubUrl: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Happy Hub</title>
<style>
  body{margin:0;padding:0;font-family:'Poppins',system-ui,sans-serif;background:#FDEFF5;color:#5C3D29;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#FFFDF7;border:1px solid #E5D2BB;border-radius:20px;padding:36px 40px;max-width:440px;width:calc(100% - 32px);text-align:center;box-shadow:0 8px 32px rgba(92,61,41,0.12)}
  h1{font-family:'AllRoundGothic','Poppins',sans-serif;font-size:28px;font-weight:800;margin:0 0 8px;color:#5C3D29;letter-spacing:-0.5px}
  p{font-size:15px;line-height:1.55;color:#84634B;margin:8px 0 24px}
  .icon{font-size:48px;margin-bottom:8px;line-height:1}
  a.btn{display:inline-block;padding:12px 22px;background:#FBF219;color:#5C3D29;text-decoration:none;font-weight:800;border-radius:999px;box-shadow:0 3px 0 #C9B30A;font-size:14px}
  a.btn:hover{background:#FFF566}
  small{display:block;margin-top:14px;color:#B89E89;font-size:12px}
</style>
</head>
<body>
  <div class="card">
    ${body}
    <a class="btn" href="${hubUrl}">Open your hub →</a>
    <small>The Happy Hub · phoebeblamey.com.au</small>
  </div>
</body>
</html>`;
}

export default async (req: Request) => {
  const secret = Netlify.env.get("QUICK_ACTION_SECRET");
  if (!secret) {
    return new Response("Server not configured (missing QUICK_ACTION_SECRET).", { status: 503 });
  }
  const url = new URL(req.url);
  const token  = url.searchParams.get("t") || "";
  const action = url.searchParams.get("a") || "";
  const clientId = url.searchParams.get("c") || "";
  const itemId = url.searchParams.get("i") || "";

  if (!token || !action || !clientId) {
    return new Response(
      htmlPage("Missing details", '<div class="icon">⚠️</div><h1>Link incomplete</h1><p>That link is missing some details. Try the latest email in your inbox.</p>', "https://hub.phoebeblamey.com.au"),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return new Response("Unknown action", { status: 400 });
  }
  if (!verifyToken(token, action, clientId, itemId, secret)) {
    return new Response(
      htmlPage("Link expired", '<div class="icon">⏰</div><h1>That link has expired</h1><p>One-tap links work for about 36 hours. Open your hub to mark this done.</p>', "https://hub.phoebeblamey.com.au"),
      { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  // ── Verified — apply the action ────────────────────────────────────
  const store = getStore("clients");
  const raw = await store.get(clientId);
  if (!raw) {
    return new Response(htmlPage("Not found", '<div class="icon">❓</div><h1>Couldn\'t find that</h1><p>Your client file isn\'t where we expected. Open your hub manually.</p>', "https://hub.phoebeblamey.com.au"), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  let client: any;
  try { client = JSON.parse(raw); } catch { return new Response("Corrupt client data", { status: 500 }); }

  const hubUrl = `https://hub.phoebeblamey.com.au/?client=${encodeURIComponent(client.clientAccess || "")}`;
  const firstName = (client.name || "").split(" ")[0] || "there";

  if (action === "task-done") {
    const task = (client.tasks || []).find((t: any) => t && t.id === itemId);
    if (!task) {
      return new Response(htmlPage("Already gone", `<div class="icon">🤔</div><h1>Couldn't find that task</h1><p>It may already be done or removed. Have a look in your hub to be sure.</p>`, hubUrl), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (task.completed) {
      return new Response(htmlPage("Already done", `<div class="icon">✅</div><h1>Already ticked off</h1><p>You\'d already marked this one done. Nice.</p>`, hubUrl), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    task.completed = true;
    task.completedAt = new Date().toISOString();
    task.completedVia = "quick-action";
    await store.set(clientId, JSON.stringify(client));
    return new Response(
      htmlPage(
        "Done",
        `<div class="icon">✨</div><h1>Done, ${firstName}.</h1><p>"${(task.text || "").slice(0, 80)}" — ticked off. Phoebe will see it on her side too.</p>`,
        hubUrl
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (action === "commit-done") {
    // itemId is the ISO date the commit was for (YYYY-MM-DD)
    client.dailyCommits = client.dailyCommits || {};
    const existing = client.dailyCommits[itemId] || "";
    // Mark as done by prepending ✓ if not already
    if (existing && existing.indexOf("✓") !== 0) {
      client.dailyCommits[itemId] = "✓ " + existing.trim();
      await store.set(clientId, JSON.stringify(client));
    }
    const commitText = (existing || "").replace(/^✓\s*/, "").slice(0, 90);
    return new Response(
      htmlPage(
        "Commit ticked",
        `<div class="icon">🐔</div><h1>Counted, ${firstName}.</h1><p>"${commitText}" — done. That's the kind of follow-through Phoebe means.</p>`,
        hubUrl
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (action === "checkin-now") {
    return new Response(
      htmlPage(
        "Open check-in",
        `<div class="icon">📅</div><h1>Let's check in.</h1><p>Click below to open your hub and answer this week's four questions. Takes about two minutes.</p>`,
        hubUrl + "#summary"
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  return new Response("Unhandled action", { status: 400 });
};

export const config: Config = { path: "/api/quick-action" };
