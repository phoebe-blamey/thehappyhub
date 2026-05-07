import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  try {
    const store = getStore("clients");

    // Check for pending new clients
    let pendingRaw = await store.get("pending_new_clients");
    if (!pendingRaw) {
      return new Response(JSON.stringify({ newClient: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let pending: string[] = [];
    try { pending = JSON.parse(pendingRaw); } catch { pending = []; }

    if (pending.length === 0) {
      return new Response(JSON.stringify({ newClient: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Return the most recent new client and remove it from the queue
    const latestId = pending.pop();
    await store.set("pending_new_clients", JSON.stringify(pending));

    const clientRaw = await store.get(latestId!);
    if (!clientRaw) {
      return new Response(JSON.stringify({ newClient: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const client = JSON.parse(clientRaw);
    return new Response(JSON.stringify({ newClient: client }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // Blobs not set up — return empty gracefully
    return new Response(JSON.stringify({ newClient: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/check-new-clients",
};
