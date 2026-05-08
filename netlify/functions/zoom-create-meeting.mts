import type { Config } from "@netlify/functions";

// POST /api/zoom-create-meeting
// Body: { topic, startDateTime?: ISO, durationMinutes?: number, recurring?: bool, weeklyOn?: number (0=Sun..6=Sat), agenda? }
//
// Returns: { joinUrl, startUrl, meetingId, passcode, topic }
//
// Used by the cohort manager: when Phoebe creates a new cohort we auto-spin
// a recurring Zoom meeting and stash the join URL on the cohort record so
// every member sees the same link.

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const accountId    = Netlify.env.get("ZOOM_ACCOUNT_ID");
  const clientId     = Netlify.env.get("ZOOM_CLIENT_ID");
  const clientSecret = Netlify.env.get("ZOOM_CLIENT_SECRET");
  if (!accountId || !clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "Zoom credentials not configured" }), { status: 503 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const topic: string = (body.topic || "Coaching session").toString().slice(0, 200);
  const durationMinutes: number = Math.max(15, Math.min(body.durationMinutes || 60, 480));
  const startDateTime: string = body.startDateTime || ""; // ISO 8601 with offset
  const recurring: boolean = !!body.recurring;
  const weeklyOn: number | undefined = (typeof body.weeklyOn === "number") ? body.weeklyOn : undefined;
  const agenda: string = (body.agenda || "").toString().slice(0, 2000);

  // ── Mint Zoom OAuth access token (Server-to-Server) ──
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
    const tokenData: any = await tokenResp.json();
    accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("No access token: " + JSON.stringify(tokenData).slice(0, 200));
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Zoom auth failed: " + String(err?.message || err) }), { status: 502 });
  }

  // ── Build the meeting payload ──
  // Type 2 = scheduled, Type 8 = recurring with fixed time
  const payload: any = {
    topic,
    type: recurring ? 8 : 2,
    duration: durationMinutes,
    timezone: "Australia/Sydney",
    agenda,
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: true,
      mute_upon_entry: false,
      auto_recording: "cloud",   // automatic cloud recording so transcripts flow into the platform
      audio: "both",
      waiting_room: false,
      meeting_authentication: false,
    },
  };
  if (startDateTime) payload.start_time = startDateTime;
  if (recurring) {
    payload.recurrence = {
      type: 2, // weekly
      repeat_interval: 1,
      end_times: 24, // ~6 months of weekly sessions; Phoebe can extend in Zoom
    };
    if (typeof weeklyOn === "number") payload.recurrence.weekly_days = String(weeklyOn + 1); // Zoom 1=Sun..7=Sat
  }

  try {
    const r = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data: any = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Zoom API error", status: r.status, details: data }), { status: r.status });
    }
    return new Response(JSON.stringify({
      success:   true,
      joinUrl:   data.join_url,
      startUrl:  data.start_url,
      meetingId: data.id,
      passcode:  data.password || data.encrypted_password || "",
      topic:     data.topic,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Failed to create Zoom meeting: " + String(err?.message || err) }), { status: 502 });
  }
};

export const config: Config = { path: "/api/zoom-create-meeting" };
