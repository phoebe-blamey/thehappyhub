import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";

// ════════════════════════════════════════════════════════════════════
// v11752 — Unsubscribe endpoint (CRITICAL compliance fix #5)
// ════════════════════════════════════════════════════════════════════
// Australian Spam Act 2003 § 17 requires every commercial electronic
// message to include a functional unsubscribe link. Every digest,
// reminder, and welcome email now embeds a signed link in the shape:
//
//   https://hub.phoebeblamey.com.au/api/unsubscribe?c=<clientId>&t=<type>&sig=<HMAC>
//
// Where:
//   c    = clientId (so we know whose preferences to update)
//   t    = type — "all" | "digest" | "reminders" | "coach"
//   sig  = HMAC-SHA256(clientId|type, QUICK_ACTION_SECRET) — first 24 hex
//
// The signature stops anyone from forging an unsubscribe URL to disable
// a different client's emails.
//
// On a valid hit we set:
//   - client.notificationsDisabled = true   (when type=all)
//   - client.prefsDigest    = false         (when type=digest)
//   - client.prefsReminders = false         (when type=reminders)
//   - client.prefsCoach     = false         (when type=coach)
// and respond with a branded HTML confirmation page.
//
// Re-subscribe is via the client-portal Settings UI — single click sets
// the pref back to true.

const TYPES = new Set(["all", "digest", "reminders", "coach"]);

function _hmacFor(clientId: string, type: string, secret: string): string {
  return createHmac("sha256", secret).update(`${clientId}|${type}`).digest("hex").slice(0, 24);
}

function _verifySig(clientId: string, type: string, providedHex: string, secret: string): boolean {
  if (!providedHex || providedHex.length !== 24) return false;
  const expected = _hmacFor(clientId, type, secret);
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(providedHex, "hex"));
  } catch {
    return false;
  }
}

function _htmlPage(opts: { title: string; body: string; success?: boolean }): string {
  const accent = opts.success ? "#0E9F6E" : "#C0392B";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${opts.title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
           background:#FDEFF5; color:#5A2D08; display:flex; align-items:center;
           justify-content:center; min-height:100vh; padding:24px; }
    .card { background:white; border-radius:16px; padding:32px 28px; max-width:480px;
            box-shadow:0 8px 32px rgba(201,38,107,0.12); border:1.5px solid rgba(229,4,139,0.15); }
    h1 { color:#C9266B; font-size:22px; margin:0 0 14px; line-height:1.25; }
    p  { font-size:14px; line-height:1.6; color:#5A2D08; margin:0 0 12px; }
    .accent { color:${accent}; font-weight:700; }
    a.btn { display:inline-block; margin-top:14px; background:#E5048B; color:white;
            text-decoration:none; padding:10px 18px; border-radius:99px; font-size:13px;
            font-weight:600; }
    a.btn:hover { background:#C9266B; }
  </style></head><body>
  <div class="card"><h1>${opts.title}</h1>${opts.body}</div></body></html>`;
}

export default async (req: Request) => {
  const u = new URL(req.url);
  const clientId = (u.searchParams.get("c") || "").trim();
  const type = (u.searchParams.get("t") || "all").trim();
  const sig = (u.searchParams.get("sig") || "").trim();

  if (!clientId || !TYPES.has(type) || !sig) {
    return new Response(_htmlPage({
      title: "Invalid unsubscribe link",
      body: "<p>The unsubscribe link is missing required parameters. If you got here from one of Phoebe's emails, please reply to the email directly and we'll handle it manually.</p>",
    }), { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const secret = Netlify.env.get("QUICK_ACTION_SECRET") || "";
  if (!secret) {
    return new Response(_htmlPage({
      title: "Server temporarily unavailable",
      body: "<p>Phoebe's unsubscribe service is being set up. Please reply to her email directly to opt out and she'll handle it manually.</p>",
    }), { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (!_verifySig(clientId, type, sig, secret)) {
    return new Response(_htmlPage({
      title: "This unsubscribe link can't be verified",
      body: "<p>The signature on this link is invalid or it's been tampered with. If you genuinely want to unsubscribe, please reply to the email directly and we'll handle it manually.</p>",
    }), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const store = getStore("clients");
  let clientName = "you";
  try {
    const raw = await store.get(clientId);
    if (!raw) {
      return new Response(_htmlPage({
        title: "Client record not found",
        body: "<p>We couldn't find your record. You may have already been removed. If you continue to receive emails, please reply directly and we'll fix it.</p>",
      }), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const client = JSON.parse(raw);
    clientName = (client.name || "").split(" ")[0] || "you";

    // Apply the unsubscribe.
    if (type === "all") {
      client.notificationsDisabled = true;
    } else if (type === "digest") {
      client.prefsDigest = false;
      // also clear the digestSchedule if set so future Mon/Fri auto-skip
      client.digestSchedule = { mondays: false, fridays: false };
    } else if (type === "reminders") {
      client.prefsReminders = false;
    } else if (type === "coach") {
      client.prefsCoach = false;
    }
    client.unsubscribedAt = new Date().toISOString();
    client.unsubscribedType = type;
    await store.set(clientId, JSON.stringify(client));
  } catch (err) {
    console.error("[unsubscribe] persist failed:", err);
    return new Response(_htmlPage({
      title: "Couldn't update right now",
      body: "<p>Something went wrong saving your preference. Please reply to Phoebe's email and she'll handle it manually.</p>",
    }), { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const friendlyType = type === "all"
    ? "all notification emails"
    : type === "digest"
      ? "Monday + Friday digests"
      : type === "reminders"
        ? "session reminders"
        : "coach broadcasts";

  return new Response(_htmlPage({
    title: `Done — ${clientName}, you're unsubscribed`,
    success: true,
    body:
      `<p>You'll no longer receive <span class="accent">${friendlyType}</span> from The Happy Hub.</p>` +
      `<p>If this was a mistake, sign in to your Hub and toggle this back on in Settings — or just reply to the email and Phoebe will turn it back on for you.</p>` +
      `<p style="font-size:12px;color:#888;margin-top:18px">Phoebe Blamey Coaching · <a href="https://hub.phoebeblamey.com.au/" style="color:#C9266B">hub.phoebeblamey.com.au</a></p>`,
  }), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
};

export const config: Config = { path: "/api/unsubscribe" };

// Helper used by daily-digest, send-reminders, calendly-webhook, etc to
// build the unsubscribe URL embedded in their outbound emails.
export function buildUnsubscribeUrl(base: string, clientId: string, type: "all" | "digest" | "reminders" | "coach", secret: string): string {
  const sig = _hmacFor(clientId, type, secret);
  return `${base.replace(/\/$/, "")}/api/unsubscribe?c=${encodeURIComponent(clientId)}&t=${type}&sig=${sig}`;
}
