import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireCoachAuth } from "./_auth.mts";

// MDC cohorts — the groupings of MDC clients with their dates, WhatsApp
// links, Zoom links, next-session times, and activeness flag.
//
// GET  /api/cohorts        → returns the array (or [])
// POST /api/cohorts        → body is the full cohorts array, replaces
//
// v11751: coach-PIN-gated (was unauthenticated — anyone could read or
// overwrite Phoebe's cohort assignments).

export default async (req: Request) => {
  const unauth = requireCoachAuth(req);
  if (unauth) return unauth;

  const store = getStore("cohorts");
  const KEY = "main";

  if (req.method === "GET") {
    try {
      const raw = await store.get(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Response(JSON.stringify(arr), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
    }
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }
    if (!Array.isArray(body)) {
      return new Response(JSON.stringify({ error: "expected array body" }), { status: 400 });
    }
    try {
      await store.set(KEY, JSON.stringify(body));
      return new Response(JSON.stringify({ success: true, count: body.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/cohorts" };
