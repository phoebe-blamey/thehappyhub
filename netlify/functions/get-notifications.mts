import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireCoachAuth } from "./_auth.mts";

// GET /api/get-notifications — returns and clears pending coach notifications
// v11751: coach-PIN-gated (was unauthenticated — anyone could drain
// Phoebe's queue of new-client alerts).
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const unauth = requireCoachAuth(req);
  if (unauth) return unauth;

  try {
    const store = getStore("notifications");
    const { blobs } = await store.list({ prefix: "notify:" });
    const notifs: any[] = [];

    for (const blob of blobs || []) {
      const raw = await store.get(blob.key);
      if (raw) {
        try {
          notifs.push(JSON.parse(raw));
          await store.delete(blob.key); // consume after reading
        } catch {}
      }
    }

    notifs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return new Response(JSON.stringify({ notifications: notifs }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ notifications: [] }), { status: 200 });
  }
};

export const config: Config = { path: "/api/get-notifications" };
