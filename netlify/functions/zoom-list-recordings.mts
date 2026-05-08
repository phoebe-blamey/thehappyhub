import type { Config } from "@netlify/functions";

// GET /api/zoom-list-recordings?days=30
// Returns Zoom cloud recordings from the past N days (default 30).
// Used by the Settings page to surface meetings that haven't been
// matched to a client yet, so Phoebe can assign them manually.
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const accountId    = Netlify.env.get("ZOOM_ACCOUNT_ID");
  const clientId     = Netlify.env.get("ZOOM_CLIENT_ID");
  const clientSecret = Netlify.env.get("ZOOM_CLIENT_SECRET");

  if (!clientId || !clientSecret || !accountId) {
    return new Response(
      JSON.stringify({ error: "Zoom credentials not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Date window
  const url   = new URL(req.url);
  const days  = Math.min(parseInt(url.searchParams.get("days") || "30", 10) || 30, 90);
  const toD   = new Date();
  const fromD = new Date(toD.getTime() - days * 86400000);
  const fromStr = fromD.toISOString().split("T")[0];
  const toStr   = toD.toISOString().split("T")[0];

  // Server-to-Server OAuth → access token
  let accessToken = "";
  try {
    const tokenResp = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
          "Content-Type":  "application/x-www-form-urlencoded",
        },
      }
    );
    const tokenData = await tokenResp.json();
    accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("No access token: " + JSON.stringify(tokenData));
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get Zoom token: " + String(err) }), { status: 500 });
  }

  // List recordings for the user (Phoebe). Zoom's API limits this window
  // to ~30 days at a time, so we may need to walk pages if days > 30.
  // For simplicity, single page of up to 100 meetings within the window.
  try {
    const recResp = await fetch(
      `https://api.zoom.us/v2/users/me/recordings?from=${fromStr}&to=${toStr}&page_size=100`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    const recData = await recResp.json();
    if (!recResp.ok) {
      return new Response(JSON.stringify({ error: "Zoom API error", status: recResp.status, details: recData }), { status: 500 });
    }
    const meetings = (recData.meetings || []).map((m: any) => ({
      uuid:      m.uuid,
      id:        String(m.id),
      topic:     m.topic || "Untitled meeting",
      startTime: m.start_time,
      duration:  m.duration,
      hasTranscript: Array.isArray(m.recording_files) && m.recording_files.some((f: any) =>
        f.file_type === "TRANSCRIPT" || f.file_extension === "VTT" || f.recording_type === "audio_transcript"
      ),
      hasRecording: Array.isArray(m.recording_files) && m.recording_files.length > 0,
    }));
    // Sort newest first
    meetings.sort((a: any, b: any) => (b.startTime || "").localeCompare(a.startTime || ""));

    return new Response(JSON.stringify({ meetings, from: fromStr, to: toStr, total: meetings.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to list recordings: " + String(err) }), { status: 500 });
  }
};

export const config: Config = { path: "/api/zoom-list-recordings" };
