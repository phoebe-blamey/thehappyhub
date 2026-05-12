// netlify/functions/_auth.mts
// v11751 — Shared auth helpers for every protected function.
//
// Files prefixed with an underscore are not routed by Netlify, so this
// module can sit alongside endpoint files and be imported by them.
//
// Three flavours of auth:
//   1. requireCoachAuth(req)    — coach UI calls. Checks x-coach-pin header
//      against COACH_ADMIN_PIN env var (defaults to "Happy_529").
//   2. requireClientAuth(req, expectedCode) — client-portal calls. Checks
//      x-client-access header against the access code on the client record.
//      Case-insensitive.
//   3. requireInternalAuth(req) — cron-triggered HTTP calls (daily-digest,
//      send-reminders are HTTP endpoints called by their cron wrappers).
//      Accepts EITHER x-cron-secret matching INTERNAL_CRON_SECRET, OR a
//      coach PIN (so manual triggers from the coach UI still work).
//
// Each returns `null` if auth is OK, or a Response object (401) if not.
// Pattern in caller:
//   const unauth = requireCoachAuth(req);
//   if (unauth) return unauth;

export function requireCoachAuth(req: Request): Response | null {
  const expected = Netlify.env.get("COACH_ADMIN_PIN") || "Happy_529";
  const providedHeader = req.headers.get("x-coach-pin") || "";
  // v11751: also accept the PIN in the request body for legacy callers like
  // delete-client.mts and seed-clients.mts that already pass `pin` in JSON.
  // We don't read the body here (caller owns the body stream); the header is
  // the canonical path going forward.
  if (providedHeader === expected) return null;
  return new Response(JSON.stringify({
    error: "Unauthorised — coach PIN required",
    hint: "Include x-coach-pin header on every coach API call.",
  }), { status: 401, headers: { "Content-Type": "application/json" } });
}

export function requireClientAuth(req: Request, expectedAccessCode: string | undefined | null): Response | null {
  const expected = (expectedAccessCode || "").toUpperCase().trim();
  if (!expected) {
    return new Response(JSON.stringify({ error: "Client record has no access code on file" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const provided = (req.headers.get("x-client-access") || "").toUpperCase().trim();
  if (provided && provided === expected) return null;
  return new Response(JSON.stringify({
    error: "Unauthorised — client access code required",
    hint: "Include x-client-access header matching the client's access code.",
  }), { status: 401, headers: { "Content-Type": "application/json" } });
}

export function requireInternalAuth(req: Request): Response | null {
  const expectedCron = Netlify.env.get("INTERNAL_CRON_SECRET") || "";
  const providedCron = req.headers.get("x-cron-secret") || "";
  if (expectedCron && providedCron === expectedCron) return null;
  // Fallback: a valid coach PIN also unlocks (so the coach UI's manual
  // "send digest now" / "run reminders now" buttons keep working).
  const expectedPin = Netlify.env.get("COACH_ADMIN_PIN") || "Happy_529";
  const providedPin = req.headers.get("x-coach-pin") || "";
  if (providedPin === expectedPin) return null;
  return new Response(JSON.stringify({
    error: "Unauthorised — internal cron call or coach PIN required",
  }), { status: 401, headers: { "Content-Type": "application/json" } });
}

// CORS helper — restrict to our canonical origins. Used by ai-call which
// is the most-abused endpoint because anyone hitting it can drive
// Anthropic costs on Phoebe's bill.
export const ALLOWED_ORIGINS = new Set([
  "https://hub.phoebeblamey.com.au",
  "https://the-happy-hub.netlify.app",
  "https://phoebeblamey.com.au",
]);

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://hub.phoebeblamey.com.au";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-coach-pin, x-client-access, x-cron-secret",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}
