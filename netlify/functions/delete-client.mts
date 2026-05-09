import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// v11500: hard-delete one or more client records from Netlify Blobs.
// PIN-guarded. Used by the Settings → Data hygiene panel for cleaning up
// demo personas, test bookings, and Zoom-sync orphan placeholder records.
//
// POST /api/delete-client
// Body: {
//   pin: "PB2025",
//   clientIds: string[]    // 1+ blob keys to delete
// }
//
// Returns: { ok, deleted: string[], notFound: string[] }
//
// Safety:
//   - Refuses to delete the canonical seeded clients without an explicit
//     `force: true` flag (defends against accidental wipe).
//   - The Elodie test client is never auto-deletable.
const PROTECTED_IDS = new Set([
  "client-elodie-b",
  // canonical real clients per CLAUDE.md
  "client-annalouise-m",
  "client-christine-l",
  "client-frances-p",
  "client-julie-j",
  "client-kari-m",
  "client-louise-s",
  "client-yvette-p",
]);

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (body.pin !== "PB2025") return new Response("Unauthorised", { status: 401 });

  const ids: string[] = Array.isArray(body.clientIds) ? body.clientIds.filter((x: any) => typeof x === "string" && x) : [];
  if (!ids.length) return new Response(JSON.stringify({ error: "clientIds[] required" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const force: boolean = body.force === true;
  const blocked = ids.filter(id => PROTECTED_IDS.has(id) && !force);
  if (blocked.length) {
    return new Response(JSON.stringify({
      error: "Refused — these IDs are protected (canonical real clients + Elodie test). Pass force:true if you really mean it.",
      blocked,
    }), { status: 409, headers: { "Content-Type": "application/json" } });
  }

  const store = getStore("clients");
  const deleted: string[] = [];
  const notFound: string[] = [];
  for (const id of ids) {
    try {
      const existing = await store.get(id);
      if (!existing) { notFound.push(id); continue; }
      await store.delete(id);
      deleted.push(id);
    } catch {
      notFound.push(id);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    deleted,
    notFound,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/delete-client" };
