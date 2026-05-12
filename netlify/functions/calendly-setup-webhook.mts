import type { Config } from "@netlify/functions";
import { randomBytes } from "node:crypto";

// v11500: one-shot helper — sets up Calendly webhook signing.
//
// Uses the existing CALENDLY_API_TOKEN to:
//   1. Find Phoebe's user URI + organization URI
//   2. List current webhook subscriptions pointing at this site
//   3. Delete every old unsigned subscription
//   4. Create a fresh subscription with a server-generated signing key
//   5. Return the signing key (one-time only — not stored)
//
// Phoebe pastes the key into Netlify env var CALENDLY_WEBHOOK_SIGNING_KEY
// to flip the webhook handler into strict-verify mode.
//
// PIN-guarded so only Phoebe can run it.
//
// POST /api/calendly-setup-webhook
// Body: { pin: "Happy_529", events?: ["invitee.created", "invitee.canceled"] }
//
// Returns: {
//   ok: true,
//   signingKey: "...",              // ONLY shown once
//   created: "<webhook-uri>",
//   deleted: ["<old-uri-1>", ...],
//   instructions: "...",
// }

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  // v11751: accept PIN in x-coach-pin header (preferred) or body.pin (legacy).
  const expectedPin = Netlify.env.get("COACH_ADMIN_PIN") || "Happy_529";
  const headerPin = req.headers.get("x-coach-pin") || "";
  if (headerPin !== expectedPin && body.pin !== expectedPin) {
    return new Response("Unauthorised", { status: 401 });
  }

  const token = Netlify.env.get("CALENDLY_API_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "CALENDLY_API_TOKEN not set in Netlify env" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const auth = `Bearer ${token}`;
  const targetUrl = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "") + "/api/calendly-webhook";
  const events: string[] = Array.isArray(body.events) && body.events.length
    ? body.events
    : ["invitee.created", "invitee.canceled"];

  try {
    // 1. Resolve user + organization URIs
    const meResp = await fetch("https://api.calendly.com/users/me", { headers: { Authorization: auth } });
    if (!meResp.ok) {
      const err = await meResp.text();
      return new Response(JSON.stringify({ error: "Calendly auth failed", detail: err.slice(0, 200) }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const me: any = await meResp.json();
    const userUri: string = me.resource.uri;
    const orgUri: string = me.resource.current_organization;

    // 2. List existing webhook subscriptions on the user scope, then org scope.
    // We delete any that point at our /api/calendly-webhook endpoint.
    const listAndCollect = async (scopeQ: string): Promise<string[]> => {
      const r = await fetch(`https://api.calendly.com/webhook_subscriptions?${scopeQ}`, { headers: { Authorization: auth } });
      if (!r.ok) return [];
      const j: any = await r.json();
      return (j.collection || [])
        .filter((sub: any) => (sub.callback_url || "").replace(/\/$/, "") === targetUrl)
        .map((sub: any) => sub.uri as string);
    };
    const userScoped = await listAndCollect(`organization=${encodeURIComponent(orgUri)}&user=${encodeURIComponent(userUri)}&scope=user`);
    const orgScoped  = await listAndCollect(`organization=${encodeURIComponent(orgUri)}&scope=organization`);
    const toDelete = Array.from(new Set([...userScoped, ...orgScoped]));

    // 3. Delete the old unsigned subscriptions
    const deleted: string[] = [];
    for (const uri of toDelete) {
      const dResp = await fetch(uri, { method: "DELETE", headers: { Authorization: auth } });
      if (dResp.ok) deleted.push(uri);
    }

    // 4. Generate signing key + create new subscription
    const signingKey = randomBytes(32).toString("hex"); // 64 hex chars

    const createResp = await fetch("https://api.calendly.com/webhook_subscriptions", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        events: events,
        organization: orgUri,
        user: userUri,
        scope: "user",
        signing_key: signingKey,
      }),
    });

    if (!createResp.ok) {
      const errText = await createResp.text();
      return new Response(JSON.stringify({
        ok: false,
        error: "Failed to create signed webhook",
        detail: errText.slice(0, 400),
        deleted,
        warning: "Old webhook(s) were deleted but the new one failed. Re-run this endpoint to retry.",
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const created: any = await createResp.json();

    return new Response(JSON.stringify({
      ok: true,
      signingKey,
      createdUri: created.resource?.uri || "",
      callbackUrl: targetUrl,
      events,
      deleted,
      instructions: [
        "1. Copy the signingKey value above.",
        "2. Open Netlify → site `the-happy-hub` → Site settings → Environment variables → Add new.",
        "3. Key: CALENDLY_WEBHOOK_SIGNING_KEY",
        "4. Value: paste the signingKey.",
        "5. Save. Netlify auto-redeploys in ~60 seconds.",
        "6. From that point every Calendly event is HMAC-verified before processing.",
      ].join("\n"),
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Setup failed: " + String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export const config: Config = { path: "/api/calendly-setup-webhook" };
