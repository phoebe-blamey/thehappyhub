import type { Config } from "@netlify/functions";

// POST /api/zoom-create-template
//
// Creates a real Zoom-side meeting template (not just a platform preset)
// in Phoebe's account, with the full Phoebe-branding stack:
//   - Topic + agenda in her voice
//   - Cloud recording auto-on
//   - Live transcription / closed captions on (accessibility)
//   - Breakout rooms enabled (MDC, group sessions)
//   - Polls allowed (engagement)
//   - Mute-on-entry off (it's a discussion)
//   - Waiting-room rules per template type
//
// Body: { templateName: 'mdc' | 'happy-hour' | '90day' | 'audit' | 'discovery' | 'session' }
//
// Returns: { templateId, templateName, seedMeetingId, joinUrl, savedToSettings: true }
//
// Flow (Zoom doesn't let you create a template "from scratch" — you save an
// existing meeting as a template):
//   1. Mint Server-to-Server OAuth token
//   2. Create a seed meeting with all branded settings via POST /users/me/meetings
//   3. Save it as a template via POST /users/me/meeting_templates
//   4. Return the template_id, also push it to /api/coach-settings so the
//      cohort + per-client Zoom flows can use it automatically.
//
// Required scopes on the Zoom Server-to-Server OAuth app (all "master" variant
// since Phoebe's app is account-level):
//   - meeting:write:meeting:master  (create the seed meeting)
//   - account:write:meeting_template:master  (save as template)
//   - meeting:read:meeting:master  (verify after creation, optional)
//
// If a scope is missing Zoom returns 401/403 with a clear message which we
// surface so Phoebe knows what to fix.

interface BrandedSettings {
  topic:    string;
  agenda:   string;
  duration: number;
  type:     2 | 8;          // 2 = scheduled, 8 = recurring with fixed time
  recurring: boolean;
  settings: Record<string, any>;
}

function brandedFor(templateName: string): BrandedSettings {
  switch (templateName) {
    case "mdc": return {
      topic: "💡 MDC · Million Dollar Conspiracy · with Phoebe Blamey",
      agenda: [
        "Welcome to the Million Dollar Conspiracy session.",
        "",
        "What we'll cover:",
        "• Wins from the week — what's working",
        "• The one thing each of you committed to last time",
        "• This week's focus + the small action that matters",
        "• Open Q&A — bring what's on your mind",
        "",
        "Keep cameras on if you can. Captions are on for the whole call.",
        "Recording goes into the hub afterwards — wins, summary and replay all in one place.",
        "",
        "Phoebe x",
      ].join("\n"),
      duration: 90,
      type: 8,
      recurring: true,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: true,
        jbh_time: 5,
        mute_upon_entry: false,
        auto_recording: "cloud",
        audio: "both",
        waiting_room: false,
        meeting_authentication: false,
        breakout_room: { enable: true },
        auto_transcript: true,
        cloud_recording_download: true,
        approval_type: 2,
        allow_multiple_devices: true,
      },
    };
    case "happy-hour": return {
      topic: "☀️ Happy Hour · with Phoebe Blamey",
      agenda: [
        "Your Happy Hour with Phoebe.",
        "",
        "90 minutes. Just you and me. We'll cover:",
        "• Where you are right now — the truthful version",
        "• The 2-3 things that are actually moving the needle",
        "• Your specific roadblocks + what we'll do about them",
        "• Action items you'll have done by Friday",
        "",
        "Bring numbers if you've got them — even messy ones.",
        "Recording lands in your hub afterwards with a polished summary you can refer back to.",
        "",
        "See you soon. Phoebe x",
      ].join("\n"),
      duration: 90,
      type: 2,
      recurring: false,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: false,
        auto_recording: "cloud",
        audio: "both",
        waiting_room: true,
        meeting_authentication: false,
        auto_transcript: true,
        cloud_recording_download: true,
        approval_type: 2,
      },
    };
    case "90day": return {
      topic: "📅 90-Day Business Builder · with Phoebe Blamey",
      agenda: [
        "Your 90-Day Business Builder session.",
        "",
        "What we'll do:",
        "• Quick check-in on the actions from last time",
        "• Reset focus on the 90-day plan we built together",
        "• Tackle whatever's biggest right now",
        "• Lock in the next 2 weeks of moves",
        "",
        "Captions on. Recording on (lands in your hub).",
        "",
        "Phoebe x",
      ].join("\n"),
      duration: 60,
      type: 2,
      recurring: false,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: false,
        auto_recording: "cloud",
        audio: "both",
        waiting_room: true,
        meeting_authentication: false,
        auto_transcript: true,
        cloud_recording_download: true,
        approval_type: 2,
      },
    };
    case "audit": return {
      topic: "🔍 Beautiful Business Audit · with Phoebe Blamey",
      agenda: [
        "Your Beautiful Business Audit.",
        "",
        "Two hours. We'll go through everything:",
        "• What you're selling + how it's positioned",
        "• Numbers — revenue, margins, where money leaks",
        "• Your audience + the journey they take to you",
        "• What the next 90 days could look like",
        "",
        "Have your numbers and website handy. Bring questions.",
        "Full session recording + a polished report land in your hub afterwards.",
        "",
        "Phoebe x",
      ].join("\n"),
      duration: 120,
      type: 2,
      recurring: false,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: false,
        auto_recording: "cloud",
        audio: "both",
        waiting_room: true,
        meeting_authentication: false,
        auto_transcript: true,
        cloud_recording_download: true,
        approval_type: 2,
      },
    };
    case "discovery": return {
      topic: "🤝 Clarity Call · with Phoebe Blamey",
      agenda: [
        "15 minutes for us to suss each other out.",
        "",
        "What we'll cover:",
        "• Where you're at + what's getting in the way",
        "• What I do + whether it's a fit",
        "• Next steps if you want to keep going",
        "",
        "No prep needed — just bring yourself and an honest answer to \"what would I love to change?\".",
        "",
        "Phoebe x",
      ].join("\n"),
      duration: 30,
      type: 2,
      recurring: false,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: false,
        auto_recording: "none",
        audio: "both",
        waiting_room: true,
        meeting_authentication: false,
        approval_type: 2,
      },
    };
    default: return {
      topic: "📌 Coaching session · with Phoebe Blamey",
      agenda: "Coaching session with Phoebe Blamey.\n\nRecording on. Captions on.\n\nPhoebe x",
      duration: 60,
      type: 2,
      recurring: false,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: false,
        auto_recording: "cloud",
        audio: "both",
        waiting_room: true,
        meeting_authentication: false,
        auto_transcript: true,
        cloud_recording_download: true,
        approval_type: 2,
      },
    };
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const accountId    = Netlify.env.get("ZOOM_ACCOUNT_ID");
  const zoomClientId = Netlify.env.get("ZOOM_CLIENT_ID");
  const zoomSecret   = Netlify.env.get("ZOOM_CLIENT_SECRET");
  if (!accountId || !zoomClientId || !zoomSecret) {
    return new Response(JSON.stringify({ error: "Zoom credentials not configured" }), { status: 503 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const templateName: string = (body.templateName || "mdc").toString();
  const branded = brandedFor(templateName);
  const templateLabel = `${templateName.toUpperCase()} master · Phoebe-branded · ${new Date().toISOString().split("T")[0]}`;

  // ── Mint Zoom token ──
  let accessToken = "";
  try {
    const tokenResp = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${zoomClientId}:${zoomSecret}`),
          "Content-Type":  "application/x-www-form-urlencoded",
        },
      }
    );
    const tokenData: any = await tokenResp.json();
    accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("No access token");
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Zoom auth failed: " + String(err?.message || err) }), { status: 502 });
  }

  // ── Step 1: Create a seed meeting with all the branded settings ──
  let seedMeeting: any = null;
  try {
    const seedPayload: any = {
      topic: branded.topic,
      type: branded.type,
      duration: branded.duration,
      timezone: "Australia/Sydney",
      agenda: branded.agenda,
      settings: branded.settings,
    };
    if (branded.recurring) {
      seedPayload.recurrence = { type: 2, repeat_interval: 1, end_times: 24 };
    }
    const r = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(seedPayload),
    });
    const data: any = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({
        error: "Couldn't create the seed meeting (needed before saving as template).",
        zoomStatus: r.status,
        zoomDetails: data,
        hint: "Most likely a missing scope. The Server-to-Server OAuth app needs: meeting:write:meeting:master.",
      }), { status: r.status, headers: { "Content-Type": "application/json" } });
    }
    seedMeeting = data;
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Seed meeting creation failed: " + String(err?.message || err) }), { status: 502 });
  }

  // ── Step 2: Save the seed meeting as a template ──
  let templateId = "";
  try {
    const tplResp = await fetch("https://api.zoom.us/v2/users/me/meeting_templates", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        meeting_id: seedMeeting.id,
        name: templateLabel,
        save_recurrence: branded.recurring,
        overwrite: true,
      }),
    });
    const tplData: any = await tplResp.json();
    if (!tplResp.ok) {
      return new Response(JSON.stringify({
        error: "Seed meeting created but couldn't be saved as a template.",
        seedMeetingId: seedMeeting.id,
        seedMeetingJoinUrl: seedMeeting.join_url,
        zoomStatus: tplResp.status,
        zoomDetails: tplData,
        hint: "Most likely a missing scope. The Server-to-Server OAuth app needs: account:write:meeting_template:master.",
      }), { status: tplResp.status, headers: { "Content-Type": "application/json" } });
    }
    templateId = String(tplData.id || tplData.template_id || "");
    if (!templateId) {
      return new Response(JSON.stringify({
        error: "Template was created but Zoom didn't return an ID we recognise.",
        zoomResponse: tplData,
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Template creation failed: " + String(err?.message || err) }), { status: 502 });
  }

  // ── Step 3: Persist the template id in coach-settings so the rest of the
  //    platform (cohort manager, per-client +Zoom button) can default to it ──
  let savedToSettings = false;
  try {
    const baseUrl = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
    const settingsResp = await fetch(`${baseUrl}/api/coach-settings`, { method: "GET" });
    let current: any = {};
    if (settingsResp.ok) {
      try { current = await settingsResp.json(); } catch {}
    }
    current.zoomTemplates = current.zoomTemplates || {};
    current.zoomTemplates[templateName] = {
      id:          templateId,
      label:       templateLabel,
      createdAt:   new Date().toISOString(),
      seedMeetingId: String(seedMeeting.id),
      seedJoinUrl: seedMeeting.join_url,
    };
    const saveResp = await fetch(`${baseUrl}/api/coach-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    });
    savedToSettings = saveResp.ok;
  } catch (err: any) {
    // Non-fatal — the template still exists in Zoom; Phoebe can paste the ID
    // manually from the response.
    console.warn("[zoom-create-template] coach-settings save failed:", err?.message || err);
  }

  return new Response(JSON.stringify({
    success:        true,
    templateId,
    templateName,
    templateLabel,
    seedMeetingId:  String(seedMeeting.id),
    joinUrl:        seedMeeting.join_url,
    savedToSettings,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/zoom-create-template" };
