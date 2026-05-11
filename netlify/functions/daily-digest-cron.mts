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
  try {
    const r = await fetch(`${url}/api/daily-digest`, { method: "POST" });
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

export const config: Config = {
  schedule: "0 22 * * *", // 22:00 UTC daily = 8am AEST / 9am AEDT
};
