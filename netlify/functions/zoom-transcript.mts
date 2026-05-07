import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Called from the client detail page: POST /api/zoom-transcript
// Body: { clientId, sessionDate }
// Finds the Zoom cloud recording for that date, pulls the transcript,
// stores it on the client record, and returns it for plan building.

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { clientId, sessionDate } = body;
  if (!clientId || !sessionDate) {
    return new Response(JSON.stringify({ error: "clientId and sessionDate required" }), { status: 400 });
  }

  const zoomToken = Netlify.env.get("ZOOM_ACCESS_TOKEN");
  const zoomAccountId = Netlify.env.get("ZOOM_ACCOUNT_ID");
  const zoomClientId = Netlify.env.get("ZOOM_CLIENT_ID");
  const zoomClientSecret = Netlify.env.get("ZOOM_CLIENT_SECRET");

  if (!zoomClientId || !zoomClientSecret || !zoomAccountId) {
    return new Response(JSON.stringify({
      error: "Zoom credentials not configured",
      setup: "Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET to Netlify environment variables. Get these from marketplace.zoom.us → Build App → Server-to-Server OAuth."
    }), { status: 503 });
  }

  // ── Get Zoom access token via Server-to-Server OAuth ──────────────────────
  let accessToken = "";
  try {
    const tokenResp = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${zoomAccountId}`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${zoomClientId}:${zoomClientSecret}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    const tokenData = await tokenResp.json();
    accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("No access token: " + JSON.stringify(tokenData));
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get Zoom token: " + String(err) }), { status: 500 });
  }

  // ── List cloud recordings for the session date ────────────────────────────
  const fromDate = sessionDate; // YYYY-MM-DD
  const toDate = sessionDate;

  let recordings: any[] = [];
  try {
    const recResp = await fetch(
      `https://api.zoom.us/v2/users/me/recordings?from=${fromDate}&to=${toDate}&page_size=30`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    const recData = await recResp.json();
    recordings = recData.meetings || [];
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to list recordings: " + String(err) }), { status: 500 });
  }

  if (!recordings.length) {
    return new Response(JSON.stringify({
      error: "No Zoom recordings found for " + sessionDate,
      hint: "Make sure cloud recording is enabled in Zoom settings and the session has finished processing (usually 15-30 mins after the call ends)."
    }), { status: 404 });
  }

  // ── Find transcript file from the most recent recording ──────────────────
  // Sort by start time descending, take most recent
  recordings.sort((a: any, b: any) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  const meeting = recordings[0];

  // Find the transcript file (VTT or audio transcript)
  const transcriptFile = (meeting.recording_files || []).find((f: any) =>
    f.file_type === "TRANSCRIPT" || f.file_extension === "VTT" || f.recording_type === "audio_transcript"
  );

  if (!transcriptFile) {
    return new Response(JSON.stringify({
      error: "Recording found but no transcript yet",
      meetingTopic: meeting.topic,
      meetingDate: meeting.start_time,
      hint: "Zoom transcripts usually take 5-15 minutes to process after recording ends. Try again shortly. Also check Zoom Settings → Recording → Audio transcript is enabled."
    }), { status: 404 });
  }

  // ── Download the transcript ───────────────────────────────────────────────
  let transcriptText = "";
  try {
    const transcriptResp = await fetch(
      transcriptFile.download_url + "?access_token=" + accessToken
    );
    const raw = await transcriptResp.text();

    // VTT format — strip timestamps and tags, keep just the speech text
    transcriptText = raw
      .split("\n")
      .filter((line: string) => {
        const trimmed = line.trim();
        return trimmed &&
          !trimmed.startsWith("WEBVTT") &&
          !trimmed.match(/^\d+$/) &&
          !trimmed.match(/^\d{2}:\d{2}:\d{2}/) &&
          !trimmed.match(/^NOTE/) &&
          !trimmed.startsWith("<");
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to download transcript: " + String(err) }), { status: 500 });
  }

  if (!transcriptText || transcriptText.length < 100) {
    return new Response(JSON.stringify({ error: "Transcript appears empty or too short", length: transcriptText.length }), { status: 422 });
  }

  // ── Store transcript on the client record ────────────────────────────────
  try {
    const store = getStore("clients");
    const clientRaw = await store.get(clientId);
    if (clientRaw) {
      const client = JSON.parse(clientRaw);
      client.zoomTranscript = transcriptText;
      client.zoomMeetingTopic = meeting.topic;
      client.zoomMeetingDate = meeting.start_time;
      client.zoomTranscriptFetchedAt = new Date().toISOString();
      await store.set(clientId, JSON.stringify(client));
    }
  } catch (err) {
    // Non-fatal — still return the transcript
    console.error("Failed to save transcript to blob:", err);
  }

  return new Response(JSON.stringify({
    success: true,
    transcript: transcriptText,
    meetingTopic: meeting.topic,
    meetingDate: meeting.start_time,
    duration: meeting.duration,
    characterCount: transcriptText.length,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/zoom-transcript",
};
