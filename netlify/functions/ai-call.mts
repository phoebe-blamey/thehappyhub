// netlify/functions/ai-call.mts
// Proxies AI calls from the browser to Anthropic so the API key stays on the server.
//
// v11751: coach-PIN-gated and CORS-restricted to our own origins (was open
// to any caller — anyone could drive Anthropic costs on Phoebe's bill and
// send arbitrary prompts that might leak client PII).

import type { Context } from "@netlify/functions";
import { requireCoachAuth, corsHeadersFor } from "./_auth.mts";

export default async (req: Request, _context: Context) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth check — coach PIN required.
  const unauth = requireCoachAuth(req);
  if (unauth) {
    return new Response(await unauth.text(), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      //
      // CRITICAL: Anthropic + web_search can take 30+ seconds to send the
      // FIRST byte (it's running web searches before generating the message).
      // Netlify's edge proxy has an "Inactivity Timeout" — if no bytes flow
      // for ~10s, it severs the connection with a 504 even though our
      // function is still happily awaiting upstream.
      //
      // Fix: wrap the upstream body in a stream that emits an SSE comment
      // line every 4 seconds while idle. The bytes are no-ops for any
      // spec-compliant SSE parser (lines starting with ":" are ignored)
      // but they keep the proxy happy.
      return new Response(withKeepAlive(resp.body), {
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

// Wraps an upstream SSE body in a ReadableStream that injects an SSE comment
// (": keep-alive\n\n") every 4 seconds. SSE parsers ignore lines that start
// with ":", so callers see no behavioural change — but the bytes flowing
// keep Netlify's edge proxy from timing the connection out while Anthropic
// runs web searches before sending its first real chunk.
function withKeepAlive(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let cancelled = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // First heartbeat right away so the response headers + a byte hit the
      // browser immediately. Some intermediaries hold the headers until the
      // first data byte arrives.
      try { controller.enqueue(encoder.encode(": connected\n\n")); } catch {}
      interval = setInterval(() => {
        if (cancelled) return;
        try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch {}
      }, 4000);
      const reader = upstream.getReader();
      try {
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        try { controller.error(err); } catch {}
      } finally {
        if (interval) clearInterval(interval);
        try { reader.releaseLock(); } catch {}
      }
    },
    cancel() {
      cancelled = true;
      if (interval) clearInterval(interval);
    },
  });
}

export const config = {
  path: "/api/ai-call",
};
