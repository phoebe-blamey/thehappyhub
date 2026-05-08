import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Single-blob coach-wide settings: custom badges, plan templates, hub
// resources, removed-resource ids, hourly rate, coach phone, notifications
// toggle, hub-view filters, etc.
//
// GET  /api/coach-settings           → returns the full JSON object (or {})
// POST /api/coach-settings           → body is either a full replacement
//                                       OR a { patch: {...} } merge
//
// All Phoebe's devices read the same record, so creating a custom badge on
// her laptop appears immediately when she opens the iPad. Lost-write risk
// is acceptable here because settings change rarely and Phoebe is the only
// writer.

export default async (req: Request) => {
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
