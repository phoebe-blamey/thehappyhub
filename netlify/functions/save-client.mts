import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// POST /api/save-client — saves a client record to Netlify Blobs
// Body: { clientId, data }
export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { clientId, data } = body;
  if (!clientId || !data) return new Response("clientId and data required", { status: 400 });

  try {
    const store = getStore("clients");
    data.updatedAt = new Date().toISOString();
    await store.set(clientId, JSON.stringify(data));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

export const config: Config = { path: "/api/save-client" };
