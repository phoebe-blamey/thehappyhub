import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Activity log shared across Phoebe's devices. Was localStorage-only —
// now persisted to a single blob so her iPad and laptop see the same
// stream of events (Calendly bookings, transcripts, AI summaries, wins,
// custom badge awards, etc).
//
// GET    /api/activity-log              → returns full array, newest first
// POST   /api/activity-log              → body { append: { ... } } pushes one event,
//                                        { entries: [...] } replaces fully (used by client-side cache)
// DELETE /api/activity-log              → wipes the log
//
// We cap the stored array at 500 entries so the blob doesn't grow forever.

const MAX_ENTRIES = 500;

export default async (req: Request) => {
  const store = getStore("activity-log");
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
    try {
      const raw = await store.get(KEY);
      const current: any[] = raw ? JSON.parse(raw) : [];
      let next: any[];
      if (body && body.append) {
        next = [body.append, ...current].slice(0, MAX_ENTRIES);
      } else if (body && Array.isArray(body.entries)) {
        next = body.entries.slice(0, MAX_ENTRIES);
      } else {
        return new Response(JSON.stringify({ error: "expected { append } or { entries }" }), { status: 400 });
      }
      await store.set(KEY, JSON.stringify(next));
      return new Response(JSON.stringify({ success: true, count: next.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
    }
  }

  if (req.method === "DELETE") {
    try { await store.set(KEY, "[]"); return new Response(JSON.stringify({ success: true }), { status: 200 }); }
    catch (err: any) { return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 }); }
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/activity-log" };
