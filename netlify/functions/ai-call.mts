// netlify/functions/ai-call.mts
// Proxies AI calls from the browser to Anthropic so the API key stays on the server.

import type { Context } from "@netlify/functions";

export default async (req: Request, _context: Context) => {
  // CORS for safety
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "Anthropic API key not configured",
        hint: "Add ANTHROPIC_API_KEY to Netlify environment variables (Site → Settings → Env vars).",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Sensible defaults
  const model = body.model || "claude-haiku-4-5-20251001";
  // Tool-using calls can be longer (web search results etc) — allow up to 8192
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const max_tokens = Math.min(body.max_tokens || 1024, hasTools ? 8192 : 4096);
  const messages = body.messages || [];
  const system = body.system; // optional

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages array is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Long-running calls (anything with tools — web_search, etc) routinely take
  // 30-90 seconds. Netlify's standard function timeout is 26 seconds, so a
  // synchronous request would hit a 504 "Inactivity Timeout". The fix: stream
  // the Anthropic response. The function returns as soon as the upstream
  // stream opens (sub-second), and Netlify keeps the response stream flowing
  // beyond the function's own execution-time limit.
  //
  // Behaviour:
  //   - If body includes `stream: true` OR the call has tools, we set
  //     stream:true upstream and pipe the raw SSE through to the client.
  //   - Otherwise (fast calls without tools), keep the existing buffered
  //     JSON response so callers expecting JSON still work.
  const wantStream = body.stream === true || hasTools;

  try {
    const payload: any = { model, max_tokens, messages };
    if (system) payload.system = system;
    if (hasTools) payload.tools = body.tools;
    if (body.tool_choice) payload.tool_choice = body.tool_choice;
    if (wantStream) payload.stream = true;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      // Read the error body whether it's streaming or not — error responses
      // are always JSON regardless of the stream flag we sent.
      const errBody = await resp.text();
      let details: any = errBody;
      try { details = JSON.parse(errBody); } catch {}
      return new Response(
        JSON.stringify({
          error: "Anthropic API error",
          status: resp.status,
          details,
        }),
        { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (wantStream && resp.body) {
      // Pipe the SSE stream straight through to the client. The browser-side
      // interceptor parses the events and reassembles them into the standard
      // Anthropic JSON shape so existing callers work unchanged.
      return new Response(resp.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          // Custom marker so the client interceptor knows to parse SSE
          "X-Anthropic-Stream": "1",
        },
      });
    }

    // Fast path: short calls return buffered JSON
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "Failed to call Anthropic", message: String(e?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  path: "/api/ai-call",
};
