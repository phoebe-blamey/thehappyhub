import type { Config } from "@netlify/functions";

// Returns which integrations are wired up (env vars present) so the
// Settings page can show real status pills. Never returns the actual
// secret values — just a boolean per integration.
//
// GET /api/integrations-status

export default async () => {
  const env = (k: string) => !!Netlify.env.get(k);
  const status = {
    gmail: env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET") && env("GOOGLE_REFRESH_TOKEN") && env("GOOGLE_SENDER_EMAIL"),
    zoom:  env("ZOOM_ACCOUNT_ID") && env("ZOOM_CLIENT_ID") && env("ZOOM_CLIENT_SECRET"),
    zoomWebhook: env("ZOOM_VERIFICATION_TOKEN"),
    calendly: env("CALENDLY_API_TOKEN"),
    // v11630: accept several plausible env-var names so the pill flips
    // green regardless of how it was typed in Netlify. Documented name
    // is CALENDLY_WEBHOOK_SIGNING_KEY but Phoebe also tried CALENDLY_KEY
    // first, so we check both. The webhook handler reads the same set.
    calendlyWebhookSigning:
      env("CALENDLY_WEBHOOK_SIGNING_KEY") ||
      env("CALENDLY_SIGNING_KEY") ||
      env("CALENDLY_WEBHOOK_KEY") ||
      env("CALENDLY_KEY"),
    anthropic: env("ANTHROPIC_API_KEY"),
    // v11742: surfaces whether Whisper audio-fallback is wired up.
    // When false, Pull-from-Zoom still works for text transcripts;
    // the audio→Whisper path returns a setup-prompt error instead.
    openaiWhisper: env("OPENAI_API_KEY"),
    twilio: env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM_NUMBER"),
    stripe: env("STRIPE_SECRET_KEY") && env("STRIPE_PUBLISHABLE_KEY"),
    stripeWebhook: env("STRIPE_WEBHOOK_SECRET"),
    whatsapp: env("WHATSAPP_PHONE_NUMBER_ID") && env("WHATSAPP_ACCESS_TOKEN"),
    whatsappWebhook: env("WHATSAPP_VERIFY_TOKEN"),
  };
  return new Response(JSON.stringify({ ok: true, status }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
  });
};

export const config: Config = { path: "/api/integrations-status" };
