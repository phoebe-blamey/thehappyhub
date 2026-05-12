import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireClientAuth } from "./_auth.mts";

// ════════════════════════════════════════════════════════════════════
// v11752 — Client data export (CRITICAL compliance fix #10)
// ════════════════════════════════════════════════════════════════════
// Australian Privacy Principle 12 + GDPR Article 15 + GDPR Article 20:
// every individual has the right to request a copy of their personal
// information held by an organisation, in a portable format.
//
// POST /api/export-my-data
// Headers: x-client-access = <their access code>
// Body:    { clientId: string }
//
// Returns the client's full record as JSON. Sensitive infrastructure
// fields are stripped (notificationsDisabled is fine; internal blob IDs
// are not — but our blob keys ARE the client.id which we expose). No
// secrets cross to the response.
//
// The response is a normal JSON document so the client can save it,
// move it to another platform, or pass it to a privacy auditor.

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const clientId = (body.clientId || "").toString().trim();
  if (!clientId) {
    return new Response(JSON.stringify({ error: "clientId required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Look up the client first so we can match their access code against the
  // x-client-access header. (We need to look up before we can verify auth.)
  const store = getStore("clients");
  const raw = await store.get(clientId);
  if (!raw) {
    return new Response(JSON.stringify({ error: "Client not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  let client: any;
  try { client = JSON.parse(raw); } catch {
    return new Response(JSON.stringify({ error: "Corrupt record" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const unauth = requireClientAuth(req, client.clientAccess);
  if (unauth) return unauth;

  // Log the export to the activity log (Phoebe sees it on her Pulse panel)
  try {
    const activityStore = getStore("activity-log");
    const logRaw = await activityStore.get("main");
    const log = logRaw ? JSON.parse(logRaw) : [];
    log.unshift({
      id: "act-export-" + Date.now(),
      kind: "data-export",
      title: `📦 ${client.name || "Client"} exported their data`,
      body: "Triggered the GDPR/APP data export from their client portal.",
      ref: { clientId },
      ts: new Date().toISOString(),
    });
    await activityStore.set("main", JSON.stringify(log.slice(0, 500)));
  } catch (err) {
    console.error("[export-my-data] activity log push failed:", err);
  }

  // Mark the export timestamp on the client record (audit trail)
  try {
    client.lastDataExportAt = new Date().toISOString();
    await store.set(clientId, JSON.stringify(client));
  } catch (err) {
    console.error("[export-my-data] persist export-stamp failed:", err);
  }

  // Build the export. Strip internal fields the client doesn't need.
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    aboutThisFile:
      "This is a complete export of the personal information The Happy Hub holds about you, in JSON format. " +
      "It includes your profile, intake, programs, session notes, plans, tasks, wins, and preferences. " +
      "You can keep it as a record, move it to another platform, or share it with a privacy auditor.",
    yourRights:
      "Under the Australian Privacy Principles you have the right to request correction or deletion at any time. " +
      "To delete your data, use the 'Delete my data' button in your Hub Settings.",
    contact: "phoebe@phoebeblamey.com.au",
    client: client,
  };

  return new Response(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="my-happy-hub-data-${clientId}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
};

export const config: Config = { path: "/api/export-my-data" };
