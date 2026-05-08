import type { Config } from "@netlify/functions";

// POST /api/zoom-create-meeting
//
// Creates a Zoom meeting using either:
//   - a built-in Phoebe-branded template (templateName: 'mdc' | 'happy-hour'
//     | '90day' | 'audit' | 'discovery' | 'session') — applies a curated
//     settings preset + Phoebe-voice topic/agenda
//   - a Zoom-account saved meeting template (templateId from the user's
//     own template library)
//   - a blank meeting (no template)
//
// Body fields:
//   topic            — overrides template default
//   startDateTime    — ISO 8601 start; omit for "any time" recurring
//   durationMinutes  — default depends on template (e.g. MDC = 90 min)
//   recurring        — if true, weekly recurring (max 24 occurrences)
//   weeklyOn         — 0=Sun..6=Sat (recurring only)
//   agenda           — overrides template default
//   templateName     — built-in preset key
//   templateId       — Zoom-side template ID (from /api/zoom-list-templates)
//   cohortName       — optional, gets injected into the branded topic
//   passcode         — optional override; Zoom auto-generates one if blank
//
// Returns: { joinUrl, startUrl, meetingId, passcode, topic, templateUsed }

// ── Phoebe-branded built-in templates ─────────────────────────────────────
// Each template defines a settings preset + a topic/agenda formatter.
// Settings reference: https://developers.zoom.us/docs/api/meetings/#tag/meetings/POST/users/{userId}/meetings
//
// Branding choices reflect Phoebe's coaching style:
// - cloud recording always on (transcripts flow into the platform)
// - captions / live transcription on (accessibility — some clients are deaf)
// - join-before-host on for cohort sessions (group culture, no awkward wait)
// - mute-on-entry OFF (it's a conversation, not a webinar)
// - waiting room OFF for cohorts (members know each other), ON for 1:1
// - breakout rooms enabled where useful (MDC, group sessions)
// - polls + Q&A enabled where useful
type TemplateKey = "mdc" | "happy-hour" | "90day" | "audit" | "discovery" | "session";

interface TemplatePreset {
  topic:    (ctx: TopicCtx) => string;
  agenda:   (ctx: TopicCtx) => string;
  duration: number;
  settings: Record<string, any>;
  recurringDefault: boolean;
}
interface TopicCtx {
  cohortName?: string;
  clientName?: string;
  weekLabel?:  string;
  custom?:     string;
}

const BRAND_TEMPLATES: Record<TemplateKey, TemplatePreset> = {
  // 💡 Million Dollar Conspiracy cohort sessions — group, recurring weekly
  "mdc": {
    topic: (c) => `💡 MDC · ${c.cohortName || "Cohort"}${c.weekLabel ? " · " + c.weekLabel : ""} · with Phoebe Blamey`,
    agenda: (c) => [
      `Welcome to the Million Dollar Conspiracy session.`,
      ``,
      `What we'll cover:`,
      `• Wins from the week — what's working`,
      `• The one thing each of you committed to last time`,
      `• This week's focus + the small action that matters`,
      `• Open Q&A — bring what's on your mind`,
      ``,
      `Keep cameras on if you can. Captions are on for the whole call.`,
      `Recording goes into the hub afterwards — wins, summary and replay all in one place.`,
      ``,
      `Phoebe x`,
    ].join("\n"),
    duration: 90,
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
      // Live transcription / captions — on by default for accessibility
      auto_transcript: true,
      cloud_recording_download: true,
      // Allow members to rename themselves (cohort culture)
      allow_multiple_devices: true,
      approval_type: 2, // no registration required
      // Show participant names + business
      show_share_button: true,
    },
    recurringDefault: true,
  },

  // ☀️ Happy Hour — single 90-minute strategy session, 1:1
  "happy-hour": {
    topic: (c) => `☀️ Happy Hour · ${c.clientName || c.custom || "Strategy session"} · with Phoebe Blamey`,
    agenda: (c) => [
      `Your Happy Hour with Phoebe.`,
      ``,
      `90 minutes. Just you and me. We'll cover:`,
      `• Where you are right now — the truthful version`,
      `• The 2-3 things that are actually moving the needle`,
      `• Your specific roadblocks + what we'll do about them`,
      `• Action items you'll have done by Friday`,
      ``,
      `Bring numbers if you've got them — even messy ones.`,
      `Recording lands in your hub afterwards with a polished summary you can refer back to.`,
      ``,
      `See you soon. Phoebe x`,
    ].join("\n"),
    duration: 90,
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      mute_upon_entry: false,
      auto_recording: "cloud",
      audio: "both",
      waiting_room: true,         // 1:1 — wait until Phoebe lets you in
      meeting_authentication: false,
      auto_transcript: true,
      cloud_recording_download: true,
      approval_type: 2,
    },
    recurringDefault: false,
  },

  // 📅 90-Day Business Builder — first session is 2hrs, follow-ups 60min
  "90day": {
    topic: (c) => `📅 90-Day Business Builder · ${c.clientName || c.custom || "Session"} · with Phoebe Blamey`,
    agenda: (c) => [
      `Your 90-Day Business Builder session.`,
      ``,
      `What we'll do:`,
      `• Quick check-in on the actions from last time`,
      `• Reset focus on the 90-day plan we built together`,
      `• Tackle whatever's biggest right now`,
      `• Lock in the next 2 weeks of moves`,
      ``,
      `Captions on. Recording on (lands in your hub).`,
      ``,
      `Phoebe x`,
    ].join("\n"),
    duration: 60,
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
    recurringDefault: false,
  },

  // 🔍 Beautiful Business Audit — 2hr deep dive, single session
  "audit": {
    topic: (c) => `🔍 Beautiful Business Audit · ${c.clientName || c.custom || "Session"} · with Phoebe Blamey`,
    agenda: (c) => [
      `Your Beautiful Business Audit.`,
      ``,
      `Two hours. We'll go through everything:`,
      `• What you're selling + how it's positioned`,
      `• Numbers — revenue, margins, where money leaks`,
      `• Your audience + the journey they take to you`,
      `• What the next 90 days could look like`,
      ``,
      `Have your numbers and website handy. Bring questions.`,
      `Full session recording + a polished report land in your hub afterwards.`,
      ``,
      `Phoebe x`,
    ].join("\n"),
    duration: 120,
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
    recurringDefault: false,
  },

  // 🤝 Discovery / Clarity Call — 15-30 min intro, no recording
  "discovery": {
    topic: (c) => `🤝 Clarity Call · ${c.clientName || c.custom || "Intro"} · with Phoebe Blamey`,
    agenda: (c) => [
      `15 minutes for us to suss each other out.`,
      ``,
      `What we'll cover:`,
      `• Where you're at + what's getting in the way`,
      `• What I do + whether it's a fit`,
      `• Next steps if you want to keep going`,
      ``,
      `No prep needed — just bring yourself and an honest answer to "what would I love to change?".`,
      ``,
      `Phoebe x`,
    ].join("\n"),
    duration: 30,
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      mute_upon_entry: false,
      auto_recording: "none",   // discovery calls aren't recorded
      audio: "both",
      waiting_room: true,
      meeting_authentication: false,
      approval_type: 2,
    },
    recurringDefault: false,
  },

  // 📌 Generic coaching session — fallback when no specific template fits
  "session": {
    topic: (c) => `📌 ${c.custom || "Coaching session"} · with Phoebe Blamey${c.clientName ? " for " + c.clientName : ""}`,
    agenda: (c) => `Coaching session with Phoebe Blamey.\n\nRecording on. Captions on.\n\nPhoebe x`,
    duration: 60,
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
    recurringDefault: false,
  },
};

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

  // Pick a built-in template if requested. Falls through to a sensible
  // default ("session") if the name is unknown.
  const templateName: TemplateKey | "" = (body.templateName || "") as any;
  const tpl = templateName && BRAND_TEMPLATES[templateName] ? BRAND_TEMPLATES[templateName] : null;

  const ctx: TopicCtx = {
    cohortName: body.cohortName,
    clientName: body.clientName,
    weekLabel:  body.weekLabel,
    custom:     body.custom || body.topic,
  };

  // Caller's explicit fields beat template defaults; otherwise template wins
  const topic: string = (body.topic || (tpl ? tpl.topic(ctx) : "Coaching session")).toString().slice(0, 200);
  const durationMinutes: number = Math.max(15, Math.min(body.durationMinutes || (tpl ? tpl.duration : 60), 480));
  const startDateTime: string = body.startDateTime || "";
  const recurring: boolean = (typeof body.recurring === "boolean") ? body.recurring : (tpl ? tpl.recurringDefault : false);
  const weeklyOn: number | undefined = (typeof body.weeklyOn === "number") ? body.weeklyOn : undefined;
  const agenda: string = (body.agenda || (tpl ? tpl.agenda(ctx) : "")).toString().slice(0, 2000);
  const passcode: string = (body.passcode || "").toString();

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
  const baseSettings = tpl ? tpl.settings : {
    host_video: true,
    participant_video: true,
    join_before_host: false,
    mute_upon_entry: false,
    auto_recording: "cloud",
    audio: "both",
    waiting_room: true,
    meeting_authentication: false,
    auto_transcript: true,
  };
  const payload: any = {
    topic,
    type: recurring ? 8 : 2,   // 2 = scheduled, 8 = recurring with fixed time
    duration: durationMinutes,
    timezone: "Australia/Sydney",
    agenda,
    settings: { ...baseSettings, ...(body.settingsOverride || {}) },
  };
  if (startDateTime) payload.start_time = startDateTime;
  if (passcode)      payload.password = passcode;
  if (recurring) {
    payload.recurrence = {
      type: 2, // weekly
      repeat_interval: 1,
      end_times: 24, // ~6 months; Phoebe can extend in Zoom
    };
    if (typeof weeklyOn === "number") payload.recurrence.weekly_days = String(weeklyOn + 1);
  }
  // Use a Zoom-saved meeting template if Phoebe picked one explicitly,
  // OR if she's run /api/zoom-create-template for this template name and
  // the resulting template_id is stored in coach-settings.zoomTemplates.
  let resolvedTemplateId: string | null = body.templateId ? String(body.templateId) : null;
  if (!resolvedTemplateId && templateName) {
    try {
      const baseUrl = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
      const r = await fetch(`${baseUrl}/api/coach-settings`);
      if (r.ok) {
        const settings: any = await r.json();
        const saved = settings && settings.zoomTemplates && settings.zoomTemplates[templateName];
        if (saved && saved.id) resolvedTemplateId = String(saved.id);
      }
    } catch {}
  }
  if (resolvedTemplateId) payload.template_id = resolvedTemplateId;

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
      success:      true,
      joinUrl:      data.join_url,
      startUrl:     data.start_url,
      meetingId:    data.id,
      passcode:     data.password || data.encrypted_password || "",
      topic:        data.topic,
      templateUsed: templateName || (body.templateId ? "zoom-saved" : "blank"),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Failed to create Zoom meeting: " + String(err?.message || err) }), { status: 502 });
  }
};

export const config: Config = { path: "/api/zoom-create-meeting" };
