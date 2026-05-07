import type { Config } from "@netlify/functions";

// POST /api/send-message
// Body: { type: 'email'|'sms', to, subject, message, clientName }
export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { type, to, subject, message, clientName } = body;
  if (!type || !to || !message) return new Response("type, to, message required", { status: 400 });

  // ── EMAIL via Resend ──────────────────────────────────────────────────────
  if (type === "email") {
    const resendKey = Netlify.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({
        error: "Email not configured",
        setup: "Add RESEND_API_KEY to Netlify environment variables. Get a free key at resend.com"
      }), { status: 503 });
    }
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Phoebe Blamey <phoebe@phoebeblamey.com.au>",
          to: [to],
          subject: subject || `A note from Phoebe`,
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
              <div style="background:#C9266B;padding:16px 24px;border-radius:12px 12px 0 0">
                <h1 style="color:white;font-size:20px;margin:0">Happy Money Hub</h1>
                <p style="color:rgba(255,255,255,0.8);font-size:12px;margin:4px 0 0">Phoebe Blamey · phoebeblamey.com.au</p>
              </div>
              <div style="background:#FFFDFA;border:1px solid #F0A3C7;border-top:none;border-radius:0 0 12px 12px;padding:24px">
                ${clientName ? `<p style="color:#ACA495;font-size:13px;margin:0 0 16px">Hi ${clientName},</p>` : ''}
                <div style="color:#C9266B;font-size:15px;line-height:1.7;white-space:pre-wrap">${message.replace(/\n/g,'<br>')}</div>
                <hr style="border:none;border-top:1px solid #FDEFF5;margin:20px 0">
                <p style="color:#ACA495;font-size:12px;margin:0">Phoebe Blamey · Business Coach & Money Strategist<br>
                <a href="https://phoebeblamey.com.au" style="color:#EC2C8A">phoebeblamey.com.au</a></p>
              </div>
            </div>`,
          text: message,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) return new Response(JSON.stringify({ error: data.message || "Send failed" }), { status: 500 });
      return new Response(JSON.stringify({ success: true, id: data.id }), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
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

export const config: Config = { path: "/api/send-message" };
