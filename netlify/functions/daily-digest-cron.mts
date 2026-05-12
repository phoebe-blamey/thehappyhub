import type { Config } from "@netlify/functions";

// Scheduled wrapper around /api/daily-digest. Runs once per day at 22:00
// UTC = 8am AEST (9am AEDT). HTTP-fetches the digest endpoint so the
// digest pipeline lives in exactly one place.
//
// Schedule pattern matches send-reminders-cron.mts — Netlify Scheduled
// Functions v2 forbid `path` + `schedule` on the same function, so we
// split: one HTTP entry (daily-digest.mts) and this cron-only file.

export default async (req: Request) => {
  const url = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
  // v11751: pass the internal cron secret so the auth gate on
  // /api/daily-digest lets this server-to-server call through.
  const cronSecret = Netlify.env.get("INTERNAL_CRON_SECRET") || "";
  try {
    const r = await fetch(`${url}/api/daily-digest`, {
      method: "POST",
      headers: cronSecret ? { "x-cron-secret": cronSecret } : {},
    });
    const data = await r.json().catch(() => ({}));
    console.log("[daily-digest-cron] result:", JSON.stringify(data).slice(0, 500));
    return new Response(JSON.stringify({ triggered: true, status: r.status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[daily-digest-cron] failed:", err?.message || err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
};

// v11745: bi-weekly cadence per Phoebe — Monday + Friday only.
// 22:00 UTC Sunday = 8am AEST Monday. 22:00 UTC Thursday = 8am AEST Friday.
// daily-digest.mts itself ALSO checks AEST day, so a stray fire on a
// non-Mon/Fri day will be a no-op.
export const config: Config = {
  schedule: "0 22 * * 0,4",
};
