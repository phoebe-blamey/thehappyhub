import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ════════════════════════════════════════════════════════════════════
// v11747 — needs-support endpoint
// ════════════════════════════════════════════════════════════════════
// Client clicks the "💬 Tell Phoebe what blocked you" link in the Friday
// digest. Lands on the portal with ?blocked=<taskId>. Front-end renders
// a focused capture form. Submit posts here with { clientId, taskId,
// reason }. We:
//   1. Append to client.needsSupport[] so the coach sees it on the
//      client detail view as a 🆘 block.
//   2. Push to activity log so Phoebe sees a notification.
//   3. Email Phoebe directly (via /api/send-message) with the reason +
//      task text + client name so she can act on it from her inbox.
//
// Body shape: { clientId, taskId, reason }
// ════════════════════════════════════════════════════════════════════

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }
  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const { clientId, taskId, reason } = body || {};
  if (!clientId || !taskId || !reason || typeof reason !== "string" || !reason.trim()) {
    return new Response(JSON.stringify({ error: "clientId, taskId, reason required" }), { status: 400 });
  }

  const store = getStore("clients");
  const raw = await store.get(clientId);
  if (!raw) return new Response(JSON.stringify({ error: "Client not found" }), { status: 404 });
  let client: any;
  try { client = JSON.parse(raw); } catch { return new Response("Corrupt client data", { status: 500 }); }

  // Resolve task text from the client record (for richer activity log)
  const task = (client.tasks || []).find((t: any) => t && t.id === taskId);
  const taskText = (task && task.text) || "(task)";

  // Append to needsSupport array (newest first)
  client.needsSupport = Array.isArray(client.needsSupport) ? client.needsSupport : [];
  const entry = {
    id: "ns-" + Date.now(),
    taskId,
    taskText,
    reason: reason.trim(),
    at: new Date().toISOString(),
    resolved: false,
  };
  client.needsSupport.unshift(entry);
  await store.set(clientId, JSON.stringify(client));

  // Push to activity log so Phoebe sees it on her Pulse panel
  try {
    const activityStore = getStore("activity-log");
    const logRaw = await activityStore.get("log");
    const log = logRaw ? JSON.parse(logRaw) : [];
    log.unshift({
      id: "act-ns-" + Date.now(),
      kind: "feedback",
      title: `🆘 ${client.name || "Client"} needs support`,
      body: `${taskText} — "${reason.trim().slice(0, 120)}"`,
      ref: { clientId },
      ts: new Date().toISOString(),
    });
    await activityStore.set("log", JSON.stringify(log.slice(0, 500)));
  } catch (err) {
    console.error("[needs-support] activity log push failed:", err);
  }

  // Email Phoebe direct so she sees it in her inbox
  try {
    const base = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
    const phoebeEmail = Netlify.env.get("GOOGLE_SENDER_EMAIL") || "phoebe@phoebeblamey.com.au";
    const emailBody =
      `${client.name || "A client"} flagged a task they got blocked on this week.\n\n` +
      `Task: ${taskText}\n\n` +
      `What blocked them:\n"${reason.trim()}"\n\n` +
      `Open their hub: ${base}/?coach=1\n\n` +
      `— sent automatically by the Happy Hub`;
    await fetch(`${base}/api/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "email",
        to: phoebeEmail,
        subject: `🆘 ${client.name || "Client"} got blocked — needs support`,
        message: emailBody,
        clientName: "Coach inbox",
      }),
    });
  } catch (err) {
    console.error("[needs-support] coach email failed:", err);
  }

  return new Response(JSON.stringify({ ok: true, entry }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/needs-support" };
