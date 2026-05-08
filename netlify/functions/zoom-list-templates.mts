import type { Config } from "@netlify/functions";

// GET /api/zoom-list-templates
//
// Returns: {
//   builtIn: [{ key, label, durationMin, description }, ...],   // platform-defined Phoebe-branded presets
//   zoomSaved: [{ id, name, type }, ...],                       // user's saved Zoom meeting templates
// }
//
// Powers the cohort manager + program detail "Use template" picker.

const BUILT_IN = [
  { key: "mdc",         label: "💡 MDC cohort session",         durationMin: 90,  description: "Recurring weekly · captions on · cloud recording · breakouts enabled · Phoebe-voice agenda" },
  { key: "happy-hour",  label: "☀️ Happy Hour (1:1, 90 min)",    durationMin: 90,  description: "Single 90-min strategy session · waiting room on · cloud recording · captions" },
  { key: "90day",       label: "📅 90-Day Builder follow-up",   durationMin: 60,  description: "Hour-long check-in · waiting room on · recording lands in client hub" },
  { key: "audit",       label: "🔍 Beautiful Business Audit",   durationMin: 120, description: "2-hour deep dive · waiting room on · recording + captions" },
  { key: "discovery",   label: "🤝 Clarity Call (15-30 min)",    durationMin: 30,  description: "Intro chat · no recording · waiting room · short" },
  { key: "session",     label: "📌 General coaching session",   durationMin: 60,  description: "Fallback preset · cloud recording · captions on" },
];

export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const accountId    = Netlify.env.get("ZOOM_ACCOUNT_ID");
  const clientId     = Netlify.env.get("ZOOM_CLIENT_ID");
  const clientSecret = Netlify.env.get("ZOOM_CLIENT_SECRET");
  if (!accountId || !clientId || !clientSecret) {
    // Built-in templates still work without Zoom configured
    return new Response(JSON.stringify({ builtIn: BUILT_IN, zoomSaved: [], note: "Zoom credentials not configured — only platform built-ins available" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // ── Mint Zoom token ──
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
    if (!accessToken) throw new Error("No access token");
  } catch (err: any) {
    return new Response(JSON.stringify({ builtIn: BUILT_IN, zoomSaved: [], note: "Zoom auth failed — only platform built-ins available", error: String(err?.message || err) }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // ── Pull user's saved Zoom meeting templates ──
  let zoomSaved: any[] = [];
  try {
    const r = await fetch("https://api.zoom.us/v2/users/me/meeting_templates", {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    if (r.ok) {
      const j: any = await r.json();
      zoomSaved = (j.templates || []).map((t: any) => ({ id: t.id, name: t.name, type: t.type }));
    }
    // 4xx means scope not granted or feature not available — silently fall back
  } catch {
    // Silent — built-ins still work
  }

  return new Response(JSON.stringify({ builtIn: BUILT_IN, zoomSaved }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=120" },
  });
};

export const config: Config = { path: "/api/zoom-list-templates" };
