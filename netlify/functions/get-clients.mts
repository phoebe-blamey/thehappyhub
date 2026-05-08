import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// GET /api/get-clients — returns all clients from Netlify Blobs.
// Lists ALL blobs in the "clients" store regardless of key prefix. The earlier
// version filtered by prefix:"client:" which silently hid every record whose
// id used the "client-" hyphen format (sync-calendly, sync-zoom, demo seed).
// The "clients" store only ever contains client records, so the prefix filter
// was both unnecessary and a real data-loss-by-display bug.
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  try {
    const store = getStore("clients");
    const { blobs } = await store.list();
    const clients: any[] = [];

    for (const blob of blobs || []) {
      if (!blob.key) continue;
      const raw = await store.get(blob.key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.id) {
          clients.push(parsed);
        }
      } catch { /* skip malformed entries */ }
    }

    // Sort by most recently updated (oldest fallback handles seeded clients)
    clients.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

    return new Response(JSON.stringify({ clients, count: clients.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

export const config: Config = { path: "/api/get-clients" };
