import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireInternalAuth } from "./_auth.mts";

// POST /api/send-message
// Body: { type: 'email'|'sms', to, subject, message, clientName, force? }
//
// Email: sends via the Gmail API as the configured GOOGLE_SENDER_EMAIL.
//        Sent emails appear in that mailbox's Sent folder automatically.
// SMS:   sends via Twilio.
//
// v11751: requires coach PIN OR internal cron secret (was unauthenticated —
// anyone could send emails/SMS as Phoebe, blasting clients with spam).
// needs-support.mts and daily-digest.mts (server-to-server) authenticate
// via x-cron-secret. The coach UI authenticates via x-coach-pin.
//
// v11755: global communications killswitch. When coach-settings.comms
// Paused is true, every outbound email/SMS to a NON-coach recipient is
// blocked (returns 200 with { blocked: true }). Emails to Phoebe's own
// address (e.g. needs-support alerts, deletion-request notifications)
// still flow through so she doesn't miss anything. Pass `force: true` in
// the body to override the killswitch for a specific send (e.g. a
// critical "Phoebe is back online" announcement).
export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const unauth = requireInternalAuth(req);
  if (unauth) return unauth;

  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { type, to, subject, message, clientName, force } = body;
  if (!type || !to || !message) return new Response("type, to, message required", { status: 400 });

  // v11755: check the global communications killswitch.
  // Phoebe's own inbox bypasses it (so internal notification emails keep
  // flowing). `force: true` in the body also bypasses (manual override).
  if (!force) {
    try {
      const settingsStore = getStore("coach-settings");
      const rawSettings = await settingsStore.get("main");
      const settings = rawSettings ? JSON.parse(rawSettings) : {};
      const paused = settings && settings.commsPaused === true;
      const coachEmail = (Netlify.env.get("GOOGLE_SENDER_EMAIL") || "").toLowerCase();
      const recipient = String(to || "").toLowerCase();
      const isToCoach = coachEmail && recipient === coachEmail;
      if (paused && !isToCoach) {
        const pausedAt = settings.commsPausedAt || "(unknown)";
        console.log(`[send-message] killswitch ON — blocking ${type} to ${to} (paused at ${pausedAt})`);
        return new Response(JSON.stringify({
          blocked: true,
          reason: "communications-killswitch",
          message: "All client emails/SMS are currently paused. Toggle off in Coach Settings → Communications.",
          to,
          type,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    } catch (err) {
      // If we can't read the settings, fail OPEN (default: don't block).
      // The killswitch is a convenience feature, not a security boundary.
      console.warn("[send-message] killswitch check failed; defaulting to send:", err);
    }
  }

  // ── EMAIL via Gmail API ──────────────────────────────────────────────────
  if (type === "email") {
    const clientId     = Netlify.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Netlify.env.get("GOOGLE_CLIENT_SECRET");
    const refreshToken = Netlify.env.get("GOOGLE_REFRESH_TOKEN");
    const senderEmail  = Netlify.env.get("GOOGLE_SENDER_EMAIL");

    if (!clientId || !clientSecret || !refreshToken || !senderEmail) {
      return new Response(JSON.stringify({
        error: "Gmail API not configured",
        setup: "Need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SENDER_EMAIL in Netlify env vars."
      }), { status: 503, headers: { "Content-Type": "application/json" } });
    }

    // 1. Mint a fresh access token from the refresh token
    let accessToken: string;
    try {
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type:    "refresh_token",
        }).toString(),
      });
      const tokenData = await tokenResp.json();
      if (!tokenResp.ok || !tokenData.access_token) {
        return new Response(JSON.stringify({
          error: "Failed to refresh Google access token",
          status: tokenResp.status,
          details: tokenData,
        }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      accessToken = tokenData.access_token;
    } catch (err) {
      return new Response(JSON.stringify({ error: "Token refresh failed: " + String(err) }), { status: 500 });
    }

    // 2. Build the MIME message — multipart/alternative (text + HTML)
    const safeSubject = (subject || "A note from Phoebe").replace(/[\r\n]/g, " ").slice(0, 988);
    const encodedSubject = /[^\x20-\x7e]/.test(safeSubject)
      ? "=?UTF-8?B?" + base64Utf8(safeSubject) + "?="
      : safeSubject;

    const html =
      '<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">' +
        '<div style="background:#C9266B;padding:16px 24px;border-radius:12px 12px 0 0">' +
          '<h1 style="color:white;font-size:20px;margin:0">Happy Money Hub</h1>' +
          '<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:4px 0 0">Phoebe Blamey · phoebeblamey.com.au</p>' +
        '</div>' +
        '<div style="background:#FFFDFA;border:1px solid #F0A3C7;border-top:none;border-radius:0 0 12px 12px;padding:24px">' +
          (clientName ? `<p style="color:#ACA495;font-size:13px;margin:0 0 16px">Hi ${escapeHtml(clientName)},</p>` : '') +
          `<div style="color:#C9266B;font-size:15px;line-height:1.7;white-space:pre-wrap">${escapeHtml(message).replace(/\n/g,'<br>')}</div>` +
          '<hr style="border:none;border-top:1px solid #FDEFF5;margin:20px 0">' +
          '<p style="color:#ACA495;font-size:12px;margin:0">Phoebe Blamey · Business Coach & Money Strategist<br>' +
          '<a href="https://phoebeblamey.com.au" style="color:#EC2C8A">phoebeblamey.com.au</a></p>' +
        '</div>' +
      '</div>';

    const boundary = "hh_" + Math.random().toString(36).slice(2);
    const mime = [
      `From: Phoebe Blamey <${senderEmail}>`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      message,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      html,
      ``,
      `--${boundary}--`,
    ].join("\r\n");

    const raw = base64UrlUtf8(mime);

    // 3. Send via Gmail API
    try {
      const sendResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({ raw }),
      });
      const sendData = await sendResp.json();
      if (!sendResp.ok) {
        return new Response(JSON.stringify({
          error: sendData.error?.message || "Gmail send failed",
          status: sendResp.status,
          details: sendData,
        }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        success: true,
        id: sendData.id,
        threadId: sendData.threadId,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Gmail send error: " + String(err) }), { status: 500 });
    }
  }

  // ── SMS via Twilio ────────────────────────────────────────────────────────
  if (type === "sms") {
    const accountSid = Netlify.env.get("TWILIO_ACCOUNT_SID");
    const authToken  = Netlify.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Netlify.env.get("TWILIO_FROM_NUMBER");
    if (!accountSid || !authToken || !fromNumber) {
      return new Response(JSON.stringify({
        error: "SMS not configured",
        setup: "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to Netlify env vars. Get these from twilio.com"
      }), { status: 503 });
    }
    try {
      const formData = new URLSearchParams({
        To: to, From: fromNumber,
        Body: `Hi${clientName ? ' ' + clientName.split(' ')[0] : ''} — ${message}\n\nPhoebe Blamey | phoebeblamey.com.au`,
      });
      const resp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        }
      );
      const data = await resp.json();
      if (!resp.ok) return new Response(JSON.stringify({ error: data.message || "SMS failed" }), { status: 500 });
      return new Response(JSON.stringify({ success: true, sid: data.sid }), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
    }
  }

  return new Response("Unknown type", { status: 400 });
};

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
}

function base64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64UrlUtf8(str: string): string {
  return base64Utf8(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const config: Config = { path: "/api/send-message" };
