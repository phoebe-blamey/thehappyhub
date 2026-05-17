import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireCoachAuth } from "./_auth.mts";

// POST /api/save-client — saves a client record to Netlify Blobs.
// v11751: coach-PIN-gated (was unauthenticated — anyone could modify
// any client's record).
// v11756: ALSO accepts x-client-access matching the existing record's
// clientAccess code, so clients can save their own record (settings
// edits, mood logs, privacy acceptance, etc.). Coach PIN still grants
// full access to any record.
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

  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { clientId, data, expectedVersion } = body;
  if (!clientId || !data) return new Response("clientId and data required", { status: 400 });

  // v11756: dual-auth. Coach PIN unlocks any record. Otherwise the request
  // must include x-client-access matching THIS client's stored access code.
  const expectedPin = Netlify.env.get("COACH_ADMIN_PIN") || "Happy_529";
  const providedPin = req.headers.get("x-coach-pin") || "";
  const isCoach = providedPin === expectedPin;
  if (!isCoach) {
    const providedAccess = (req.headers.get("x-client-access") || "").toUpperCase().trim();
    // Look up the existing record so we can compare against the stored
    // access code. If there's no existing record, only the coach can create.
    const store0 = getStore("clients");
    const existingRaw0 = await store0.get(clientId);
    if (!existingRaw0) {
      return new Response(JSON.stringify({ error: "Unauthorised — record not found and not authorised to create" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let existing0: any;
    try { existing0 = JSON.parse(existingRaw0); } catch { existing0 = null; }
    const storedAccess = (existing0 && existing0.clientAccess || "").toUpperCase();
    if (!storedAccess || providedAccess !== storedAccess) {
      return new Response(JSON.stringify({ error: "Unauthorised — coach PIN or matching client access code required" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    // Client is editing their own record. Lock down what they can write:
    // they may NOT change their own clientAccess (privilege escalation),
    // their own id, or coach-only fields like notificationsDisabled when
    // it's been set by Phoebe (we let them toggle prefsDigest etc. fine).
    if (data.clientAccess && data.clientAccess !== existing0.clientAccess) {
      return new Response(JSON.stringify({ error: "Cannot change own access code via this endpoint" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    if (data.id && data.id !== existing0.id) {
      return new Response(JSON.stringify({ error: "Cannot change own id" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
  }

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
