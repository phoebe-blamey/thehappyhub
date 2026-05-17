import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireInternalAuth } from "./_auth.mts";

// Single-blob coach-wide settings: custom badges, plan templates, hub
// resources, removed-resource ids, hourly rate, coach phone, notifications
// toggle, hub-view filters, etc.
//
// GET  /api/coach-settings           → returns the full JSON object (or {})
// POST /api/coach-settings           → body is either a full replacement
//                                       OR a { patch: {...} } merge
//
// v11751: requires coach PIN OR internal cron secret. daily-digest and
// send-reminders read this blob server-to-server (for email templates)
// using x-cron-secret. The coach UI uses x-coach-pin.
// v11756: GET is now PUBLIC so the client portal can read shared data
// (hub resources, cohort metadata, coach phone shown in the help drawer).
// Most fields here are non-sensitive (badge configs, resource library).
// POST is still gated — only Phoebe / cron can write.

export default async (req: Request) => {
  // v11756: only gate POST. GET is publicly readable.
  if (req.method === "POST") {
    const unauth = requireInternalAuth(req);
    if (unauth) return unauth;
  }

  const store = getStore("coach-settings");
  const KEY = "main";

  if (req.method === "GET") {
    try {
      const raw = await store.get(KEY);
      const data = raw ? JSON.parse(raw) : {};
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }
    try {
      let next: any;
      if (body && typeof body === "object" && body.patch && typeof body.patch === "object") {
        // Patch mode — read current, merge, write
        const raw = await store.get(KEY);
        const current = raw ? JSON.parse(raw) : {};
        next = Object.assign({}, current, body.patch);
      } else {
        // Full replacement
        next = body;
      }
      next.updatedAt = new Date().toISOString();
      await store.set(KEY, JSON.stringify(next));
      return new Response(JSON.stringify({ success: true, settings: next }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/coach-settings" };
