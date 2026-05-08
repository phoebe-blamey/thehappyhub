import type { Config } from "@netlify/functions";

// Scheduled-only wrapper around /api/send-reminders.
//
// Why a separate file: in v9000 I tried `path` + `schedule` on a single
// function, which Netlify's bundler rejected outright (silent build
// failure that took 6 commits to spot). The fix is to split: one file
// for HTTP (path:'/api/send-reminders'), one for cron (this file, with
// only `schedule`). Both call the same inline pipeline by HTTP-fetching
// the HTTP variant, which keeps the reminder logic in exactly one place.
//
// Cadence: every 10 minutes. The reminder function itself dedupes by
// (clientId, programId, sessionISO, tier) so duplicate fires are safe.

export default async (req: Request) => {
  const url = (Netlify.env.get("URL") || "https://hub.phoebeblamey.com.au").replace(/\/$/, "");
  try {
    const r = await fetch(`${url}/api/send-reminders`, { method: "POST" });
    const data = await r.json().catch(() => ({}));
    console.log("[send-reminders-cron] result:", JSON.stringify(data).slice(0, 500));
    return new Response(JSON.stringify({ triggered: true, status: r.status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[send-reminders-cron] failed:", err?.message || err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
};

// Netlify Scheduled Functions v2: schedule only, no path. The function
// is invoked by Netlify's cron, never by HTTP, so no public URL leak.
export const config: Config = {
  schedule: "*/10 * * * *",
};
