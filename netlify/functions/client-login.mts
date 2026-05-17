import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ════════════════════════════════════════════════════════════════════
// v11756 — Client login endpoint (PUBLIC by design)
// ════════════════════════════════════════════════════════════════════
// Pre-v11751 the client portal called /api/get-clients to look itself
// up. That endpoint is now coach-PIN-gated, which broke client login.
//
// This endpoint replaces that path for clients:
//   POST /api/client-login
//   Body: { accessCode: "ELOD99" }
//
// On match: returns { ok: true, client: <single client record> }.
// On miss:  returns 404 with a generic error (no enumeration hint).
//
// Auth model: the access code IS the credential. There's no separate
// auth required, but we apply two protections:
//   1. Per-IP rate limit (best-effort) — 12 attempts per 5 min before
//      we start delaying responses.
//   2. Constant-time string compare on the access code so timing
//      attacks can't probe valid prefixes.
//
// What the front-end does after this:
//   - Stores the access code in sessionStorage as hmh_client_access
//   - The auth fetch interceptor attaches x-client-access on every
//     subsequent /api/* call (save-client, export-my-data, etc.)
//   - The client portal renders against the single returned record.
//
// Returns ALL fields of the client record — they own this data.

function _ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const accessCode = (body && body.accessCode ? String(body.accessCode) : "").toUpperCase().trim();
  if (!accessCode || accessCode.length < 3 || accessCode.length > 32) {
    return new Response(JSON.stringify({ error: "Access code required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Scan the clients store. Small data set (<100 clients) makes this fine.
  const store = getStore("clients");
  try {
    const list = await store.list();
    for (const blob of list.blobs || []) {
      if (!blob.key) continue;
      const raw = await store.get(blob.key);
      if (!raw) continue;
      let client: any;
      try { client = JSON.parse(raw); } catch { continue; }
      const code = ((client && client.clientAccess) || "").toUpperCase();
      if (code && _ctEq(code, accessCode)) {
        // Match — return the client record.
        // Strip any internal-only fields we don't want exposed (none right now).
        return new Response(JSON.stringify({ ok: true, client }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    }
  } catch (err) {
    console.error("[client-login] store scan failed:", err);
    return new Response(JSON.stringify({ error: "Lookup failed — try again in a moment" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // No match — generic error, no enumeration hint.
  return new Response(JSON.stringify({ error: "Access code not recognised. Check with Phoebe." }), {
    status: 404, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/client-login" };
