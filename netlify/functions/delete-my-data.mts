import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireClientAuth } from "./_auth.mts";

// ════════════════════════════════════════════════════════════════════
// v11752 — Client data deletion request (CRITICAL compliance fix #10)
// ════════════════════════════════════════════════════════════════════
// APP Principle 13 + GDPR Article 17: every individual has the right
// to request deletion of their personal information.
//
// POST /api/delete-my-data
// Headers: x-client-access = <their access code>
// Body:    { clientId, confirm: true, reason?: string }
//
// Behaviour: SOFT delete + email Phoebe. We don't hard-delete on the
// client-portal-triggered path because:
//   - It's an irreversible action and clients sometimes change their
//     minds within hours.
//   - Phoebe needs to see the request so she can do a personal
//     follow-up before honouring it.
//   - Tax/financial records may need to be retained per Australian
//     tax law (7 years for some).
//
// What we DO do here:
//   1. Set client.deletionRequestedAt + client.deletionReason.
//   2. Stop ALL further automated email/SMS by setting
//      notificationsDisabled=true + prefs* to false.
//   3. Push an alert to the activity log.
//   4. Email Phoebe directly so she can run the actual hard-delete
//      manually within 30 days (matching our retention policy).
//   5. Return a confirmation to the client.
//
// The hard-delete itself stays in delete-client.mts (coach-PIN-gated).

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const clientId = (body.clientId || "").toString().trim();
  const reason = (body.reason || "").toString().slice(0, 500);
  const confirmed = body.confirm === true;
  if (!clientId) {
    return new Response(JSON.stringify({ error: "clientId required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!confirmed) {
    return new Response(JSON.stringify({ error: "Set confirm:true to request deletion" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

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

  // Soft delete + suppress all comms
  client.deletionRequestedAt = new Date().toISOString();
  client.deletionReason = reason;
  client.notificationsDisabled = true;
  client.prefsDigest = false;
  client.prefsReminders = false;
  client.prefsCoach = false;
  try {
    await store.set(clientId, JSON.stringify(client));
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to save deletion request: " + String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Activity log
  try {
    const activityStore = getStore("activity-log");
    const logRaw = await activityStore.get("main");
    const log = logRaw ? JSON.parse(logRaw) : [];
    log.unshift({
      id: "act-delreq-" + Date.now(),
      kind: "data-deletion",
      title: `🗑 ${client.name || "Client"} requested data deletion`,
      body: reason ? `Reason: "${reason.slice(0, 200)}"` : "No reason given. Soft-deleted; hard-delete within 30 days.",
      ref: { clientId },
      ts: new Date().toISOString(),
    });
    await activityStore.set("main", JSON.stringify(log.slice(0, 500)));
  } catch (err) {
    console.error("[delete-my-data] activity log push failed:", err);
  }

  // Email Phoebe
  try {
    const base = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
    const phoebeEmail = Netlify.env.get("GOOGLE_SENDER_EMAIL") || "phoebe@phoebeblamey.com.au";
    const body =
      `${client.name || "A client"} has requested deletion of their data via the Hub.\n\n` +
      `Client: ${client.name || "(no name)"} <${client.email || "(no email)"}>\n` +
      `Code:   ${client.clientAccess || "(none)"}\n` +
      `When:   ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}\n` +
      (reason ? `Reason:\n"${reason}"\n\n` : "\n") +
      `Their data has been soft-deleted (all emails/SMS suppressed). Per our retention policy, ` +
      `the hard delete must happen within 30 days. Use the Settings → Data hygiene panel to do the hard delete when ready.\n\n` +
      `If you think this was sent in error, you can re-enable their notifications from the same panel.\n\n` +
      `— sent automatically by the Happy Hub`;
    await fetch(`${base}/api/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": Netlify.env.get("INTERNAL_CRON_SECRET") || "",
      },
      body: JSON.stringify({
        type: "email",
        to: phoebeEmail,
        subject: `🗑 Deletion request from ${client.name || "client"}`,
        message: body,
        clientName: "Coach inbox",
      }),
    });
  } catch (err) {
    console.error("[delete-my-data] coach email failed:", err);
  }

  return new Response(JSON.stringify({
    ok: true,
    deletionRequestedAt: client.deletionRequestedAt,
    message: "Your deletion request has been received. Phoebe will be notified and your data will be removed within 30 days. All emails and SMS to you have already been stopped.",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/delete-my-data" };
