import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireCoachAuth } from "./_auth.mts";

// GET /api/get-clients — returns all clients from Netlify Blobs.
// v11751: coach-PIN-gated (was unauthenticated — anyone with the URL
// could fetch every client's full PII).
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const unauth = requireCoachAuth(req);
  if (unauth) return unauth;

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
