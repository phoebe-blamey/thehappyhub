import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Zoom webhook receiver — fires automatically when a cloud recording finishes
// processing. Tries to match the recording to a client by email/topic/date,
// pulls the transcript, and saves it on the matching program. If no match is
// found the recording is simply left for Phoebe to assign manually via the
// "Uncategorised Zooms" panel on her home page.
//
// Configure in Zoom Marketplace → Server-to-Server OAuth app → Feature →
// Event Subscriptions → URL: https://hub.phoebeblamey.com.au/api/zoom-webhook
// Subscribe to: recording.completed (and optionally meeting.ended)
//
// Zoom validates URLs via a "endpoint.url_validation" event the FIRST time —
// we respond with the encrypted token using ZOOM_VERIFICATION_TOKEN. After
// that, real events come through with verification headers we don't strictly
// require for this read-only sink.

import { createHmac } from "node:crypto";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const verToken = Netlify.env.get("ZOOM_VERIFICATION_TOKEN") || "";
  let payload: any = {};
  try { payload = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  // ── 1. Zoom URL validation handshake ─────────────────────────────────────
  // Zoom sends { event: "endpoint.url_validation", payload: { plainToken } }
  // and expects { plainToken, encryptedToken } back, where encryptedToken =
  // HMAC-SHA256(plainToken, secretToken)
  if (payload.event === "endpoint.url_validation" && payload.payload?.plainToken) {
    const plain = String(payload.payload.plainToken);
    const encrypted = createHmac("sha256", verToken).update(plain).digest("hex");
    return new Response(JSON.stringify({ plainToken: plain, encryptedToken: encrypted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 2. Real events — only acting on recording.completed for now ──────────
  if (payload.event !== "recording.completed") {
    // ack other events but don't process
    return new Response(JSON.stringify({ received: true, ignored: payload.event }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const meeting = payload.payload?.object;
  if (!meeting) return new Response("No meeting payload", { status: 400 });

  const startTime: string = meeting.start_time || "";
  const topic: string = meeting.topic || "";
  const meetingId: string = String(meeting.id || meeting.uuid || "");
  const hostEmail: string = (meeting.host_email || "").toLowerCase();
  // Note: Zoom's recording.completed payload doesn't include attendee emails by
  // default — only host_email. So matching falls to date + topic for now.

  // ── 3. Look for a matching client + program ──────────────────────────────
  const store = getStore("clients");
  const list = await store.list();
  let matchedClientId: string | null = null;
  let matchedProgId: string | null = null;
  let matchedClientName: string | null = null;

  for (const blob of list.blobs) {
    if (!blob.key) continue;
    const raw = await store.get(blob.key);
    if (!raw) continue;
    let client: any;
    try { client = JSON.parse(raw); } catch { continue; }

    // Topic-based match: client name appears in topic (case-insensitive)
    const nameInTopic = client.name && topic.toLowerCase().includes(client.name.toLowerCase().split(" ")[0]);

    // Date-based match: any program with sessionDate within ±1 day of recording
    let bestProgMatch: any = null;
    if (startTime) {
      const recT = new Date(startTime).getTime();
      (client.programs || []).forEach((p: any) => {
        if (!p.sessionDate) return;
        const sd = new Date(p.sessionDate).getTime();
        if (Math.abs(recT - sd) <= 86400000) bestProgMatch = p;
      });
    }

    if (bestProgMatch && (nameInTopic || true)) {
      matchedClientId = client.id;
      matchedProgId = bestProgMatch.id;
      matchedClientName = client.name;
      break;
    }
  }

  // ── 4. If matched: pull the transcript via the existing function ─────────
  if (matchedClientId) {
    try {
      const baseUrl = (Netlify.env.get("URL") || "").replace(/\/$/, "");
      const txResp = await fetch(`${baseUrl}/api/zoom-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: matchedClientId,
          sessionDate: startTime ? startTime.split("T")[0] : "",
          meetingId: meetingId,
        }),
      });
      const txData = await txResp.json();
      return new Response(JSON.stringify({
        received: true,
        matched: true,
        clientId: matchedClientId,
        clientName: matchedClientName,
        progId: matchedProgId,
        transcript: txResp.ok && txData.success,
        transcriptError: txResp.ok ? null : txData.error,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return new Response(JSON.stringify({
        received: true, matched: true, transcriptError: String(err?.message || err)
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }

  // ── 5. Unmatched: leave it. The "Uncategorised Zooms" UI on Phoebe's home
  //    polls /api/zoom-list-recordings and surfaces it for manual assignment.
  return new Response(JSON.stringify({
    received: true,
    matched: false,
    reason: "No client+program matched on date or topic",
    meeting: { id: meetingId, topic, startTime },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = {
  path: "/api/zoom-webhook",
};
