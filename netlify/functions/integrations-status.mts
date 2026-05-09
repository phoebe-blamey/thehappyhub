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
    calendlyWebhookSigning: env("CALENDLY_WEBHOOK_SIGNING_KEY"),
    anthropic: env("ANTHROPIC_API_KEY"),
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
