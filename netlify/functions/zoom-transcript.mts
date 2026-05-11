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

  const { clientId, sessionDate, meetingId } = body;
  if (!clientId || (!sessionDate && !meetingId)) {
    return new Response(JSON.stringify({ error: "clientId and (sessionDate or meetingId) required" }), { status: 400 });
  }

  // v11440 cleanup: removed read of deprecated ZOOM_ACCESS_TOKEN env var —
  // the OAuth flow below generates a fresh access token from the
  // ACCOUNT_ID + CLIENT_ID + CLIENT_SECRET trio every call, so a static
  // pre-issued token isn't needed (and was never populated).
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

  // v11738: pull the client record FIRST so we can name-match recordings.
  // Was matching purely by date proximity — which silently grabbed the
  // wrong client's recording when their session dates were close
  // together. Phoebe reported "Pull from Zoom on Scott Taylor pulled in
  // Sam's transcript".
  let clientName = "";
  let clientFirstName = "";
  try {
    const store = getStore("clients");
    const clientRaw = await store.get(clientId);
    if (clientRaw) {
      const cobj = JSON.parse(clientRaw);
      clientName = (cobj.name || "").trim();
      clientFirstName = clientName.split(/\s+/)[0] || "";
    }
  } catch (err) {
    // Non-fatal — name match just won't apply. Falls through to date-only.
  }

  // ── Fetch the specific meeting (if meetingId given) or list by date ──────
  let meeting: any = null;
  let nameMatchedFlag = false;
  try {
    if (meetingId) {
      // Direct fetch of the specific meeting's recordings — used when assigning
      // an unmatched Zoom recording to a client from the Settings page.
      const directResp = await fetch(
        `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/recordings`,
        { headers: { "Authorization": `Bearer ${accessToken}` } }
      );
      const directData = await directResp.json();
      if (!directResp.ok) {
        return new Response(JSON.stringify({
          error: "Zoom meeting not found",
          status: directResp.status,
          details: directData,
        }), { status: 404 });
      }
      meeting = directData;
    } else {
      // Fall back to list-by-date — search a ±7 day window centred on
      // sessionDate, then pick the recording closest to the session date
      // AND whose topic mentions the client. Name match is the primary
      // filter; date proximity only tie-breaks within matched results.
      const target = new Date(sessionDate);
      const fromD = new Date(target.getTime() - 7 * 86400000);
      const toD   = new Date(target.getTime() + 7 * 86400000);
      const fromStr = fromD.toISOString().split("T")[0];
      const toStr   = toD.toISOString().split("T")[0];
      const recResp = await fetch(
        `https://api.zoom.us/v2/users/me/recordings?from=${fromStr}&to=${toStr}&page_size=100`,
        { headers: { "Authorization": `Bearer ${accessToken}` } }
      );
      const recData = await recResp.json();
      const allRecordings: any[] = recData.meetings || [];
      if (!allRecordings.length) {
        return new Response(JSON.stringify({
          error: `No Zoom recordings found between ${fromStr} and ${toStr}`,
          hint: "Searched a 14-day window around the session date. Check cloud recording is enabled in Zoom and the session has finished processing (usually 15-30 mins after the call ends).",
          sessionDate: sessionDate,
          searchedFrom: fromStr,
          searchedTo: toStr,
        }), { status: 404 });
      }
      // v11738: NAME MATCH first. Look for any recording whose topic
      // contains the client's first name OR full name (case-insensitive,
      // word-boundary aware so "Sam" doesn't match "Samira" or "Samuel").
      let candidates = allRecordings;
      if (clientFirstName) {
        const firstLower = clientFirstName.toLowerCase();
        const fullLower = clientName.toLowerCase();
        const nameMatched = allRecordings.filter((r: any) => {
          const topic = (r.topic || "").toLowerCase();
          if (!topic) return false;
          // word-boundary match on first name
          const wbRe = new RegExp("\\b" + firstLower.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "\\b", "i");
          if (wbRe.test(topic)) return true;
          // OR full name substring
          if (fullLower && topic.indexOf(fullLower) >= 0) return true;
          return false;
        });
        if (nameMatched.length) {
          candidates = nameMatched;
          nameMatchedFlag = true;
        }
      }
      // If we still have multiple candidates (or name-match failed), pick
      // the recording closest to the session date.
      const targetT = target.getTime();
      candidates.sort((a: any, b: any) => {
        const da = Math.abs(new Date(a.start_time).getTime() - targetT);
        const db = Math.abs(new Date(b.start_time).getTime() - targetT);
        return da - db;
      });
      meeting = candidates[0];
      // If no name match found and there are MULTIPLE recordings in the
      // window, surface that as a warning rather than silently grabbing
      // one. Phoebe can use the unmatched-recordings UI to assign.
      if (clientFirstName && !nameMatchedFlag && allRecordings.length > 1) {
        return new Response(JSON.stringify({
          error: `No Zoom recording in the date window has '${clientFirstName}' in the topic`,
          hint: `Found ${allRecordings.length} recording(s) between ${fromStr} and ${toStr} but none mention this client's name in the topic. Open Settings → Unmatched Zoom Recordings to assign one manually, or check the meeting title in Zoom.`,
          clientName,
          searchedFrom: fromStr,
          searchedTo: toStr,
          availableTopics: allRecordings.slice(0, 8).map((r: any) => r.topic),
        }), { status: 404 });
      }
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch meeting: " + String(err) }), { status: 500 });
  }

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
  // v11738: was using `?access_token=` query param which sometimes returns
  // Zoom's HTML auth-flow page (with embedded JavaScript cookie code)
  // instead of the VTT — Phoebe saw that JS code in the transcript field.
  // Switch to Authorization header + redirect:follow + Content-Type check.
  let transcriptText = "";
  let raw = "";
  try {
    const transcriptResp = await fetch(
      transcriptFile.download_url,
      {
        headers: { "Authorization": `Bearer ${accessToken}` },
        redirect: "follow",
      }
    );
    const contentType = transcriptResp.headers.get("content-type") || "";
    raw = await transcriptResp.text();

    // Reject if Zoom returned HTML (auth-flow page or error page). Empty
    // VTT is also rejected below.
    if (
      contentType.indexOf("text/html") >= 0 ||
      raw.trim().toLowerCase().startsWith("<!doctype") ||
      raw.trim().toLowerCase().startsWith("<html") ||
      raw.indexOf("zoom.us/oauth") >= 0 ||
      raw.indexOf("function createCookie") >= 0
    ) {
      return new Response(JSON.stringify({
        error: "Zoom returned an HTML page instead of the transcript file",
        hint: "This usually means the Zoom access token needs a wider scope. In the Zoom Marketplace, open the Happy Hub app → Scopes → ensure cloud_recording:read:content:master is enabled. Then try again.",
        contentType,
        rawSample: raw.slice(0, 200),
      }), { status: 502 });
    }

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
    return new Response(JSON.stringify({
      error: "Transcript appears empty or too short",
      length: transcriptText.length,
      hint: "Zoom transcripts can take 5-15 minutes to fully process after a call ends. Try again shortly. If it stays empty, check Zoom Settings → Recording → Audio transcript is enabled.",
    }), { status: 422 });
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
    nameMatched: nameMatchedFlag,
    clientName,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/zoom-transcript",
};
