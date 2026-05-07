import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// GET /api/get-clients — returns all clients from Netlify Blobs
// Used by the coach portal to load real persisted data
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  try {
    const store = getStore("clients");
    const { blobs } = await store.list({ prefix: "client:" });
    const clients: any[] = [];

    for (const blob of blobs || []) {
      const raw = await store.get(blob.key);
      if (raw) {
        try { clients.push(JSON.parse(raw)); } catch {}
      }
    }

    // Sort by most recently updated
    clients.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

    return new Response(JSON.stringify({ clients }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

export const config: Config = { path: "/api/get-clients" };
