import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireCoachAuth } from "./_auth.mts";

// POST /api/save-client — saves a client record to Netlify Blobs.
// v11751: coach-PIN-gated (was unauthenticated — anyone could modify
// any client's record).
//
// Body: { clientId, data, expectedVersion? }
//   - clientId          : blob key
//   - data              : the client object to save
//   - expectedVersion   : (optional) the updatedAt timestamp the client thinks
//                         the server has. If provided and the server's stored
//                         version is NEWER, save is rejected with 409 Conflict
//                         and the current server version is returned so the
//                         client can merge or warn the user. This protects
//                         against e.g. a Calendly webhook appending a program
//                         while the coach is mid-edit on the same client.
//
// The response always includes the final `updatedAt` so the client can keep
// its "expectedVersion" tracker in sync after a successful save.
export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const unauth = requireCoachAuth(req);
  if (unauth) return unauth;

  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { clientId, data, expectedVersion } = body;
  if (!clientId || !data) return new Response("clientId and data required", { status: 400 });

  try {
    const store = getStore("clients");

    // Optimistic concurrency check (only when expectedVersion is supplied).
    // A client that doesn't care about concurrency (e.g. a webhook) can omit
    // it and get the legacy "last-write-wins" behaviour.
    if (expectedVersion) {
      const existingRaw = await store.get(clientId);
      if (existingRaw) {
        let existing: any;
        try { existing = JSON.parse(existingRaw); } catch { existing = null; }
        if (existing && existing.updatedAt && existing.updatedAt > expectedVersion) {
          return new Response(JSON.stringify({
            error: "Client was updated elsewhere",
            code: "version_conflict",
            serverUpdatedAt: existing.updatedAt,
            clientExpected: expectedVersion,
            current: existing,
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
      }
    }

    data.updatedAt = new Date().toISOString();
    await store.set(clientId, JSON.stringify(data));
    return new Response(JSON.stringify({
      success: true,
      updatedAt: data.updatedAt,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

export const config: Config = { path: "/api/save-client" };
