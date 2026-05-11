import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ════════════════════════════════════════════════════════════════════
// v11745 — Large-audio transcription via AssemblyAI (background fn)
// ════════════════════════════════════════════════════════════════════
// Triggered by zoom-transcript.mts when:
//   • Zoom's text transcript isn't ready yet
//   • The Zoom audio file is >25 MB (so Whisper can't handle it)
//   • ASSEMBLYAI_API_KEY is set
//
// AssemblyAI accepts files up to 5 GB — handles every 90-min coaching
// session comfortably. Pricing: ~$0.37/hour. Free tier: 100 hours/month.
//
// Pattern: this is a Netlify BACKGROUND FUNCTION (filename ends with
// -background.mts). They get a 15-minute timeout — plenty for the
// upload + polling cycle (~3-5 min for a 90-min session).
//
// Flow:
//   1. Fetch Zoom audio via Bearer token
//   2. POST raw bytes to AssemblyAI /v2/upload → get audio_url
//   3. POST { audio_url } to /v2/transcript → get transcript id
//   4. Poll /v2/transcript/{id} every 5s until status=completed
//   5. Save transcribed text to the client record + activity log
//   6. Future polling from the front-end picks it up
//
// Triggered via HTTP POST with { clientId, accessToken, audioUrl,
// fileExt, meetingTopic, meetingDate, source: "zoom" }.
// ════════════════════════════════════════════════════════════════════

async function postJson(url: string, headers: Record<string, string>, body: any) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { clientId, accessToken, audioUrl, meetingTopic, meetingDate, sessionDate } = body;
  const aaiKey = Netlify.env.get("ASSEMBLYAI_API_KEY");

  if (!aaiKey) {
    return new Response(JSON.stringify({ error: "ASSEMBLYAI_API_KEY not set" }), { status: 503 });
  }
  if (!clientId || !audioUrl || !accessToken) {
    return new Response(JSON.stringify({ error: "clientId, audioUrl, accessToken required" }), { status: 400 });
  }

  const store = getStore("clients");
  const activityStore = getStore("activity-log");

  // Mark "transcribing" status on the client record so the UI can show progress
  async function markStatus(status: string, extra: any = {}) {
    try {
      const raw = await store.get(clientId);
      if (!raw) return;
      const client = JSON.parse(raw);
      client.zoomTranscriptStatus = status;
      client.zoomTranscriptStatusAt = new Date().toISOString();
      Object.assign(client, extra);
      await store.set(clientId, JSON.stringify(client));
    } catch (err) {
      console.error("[transcribe-large-audio-bg] markStatus failed:", err);
    }
  }

  await markStatus("uploading", {
    zoomTranscriptStatusMessage: "Downloading audio from Zoom…",
    zoomMeetingTopic: meetingTopic,
    zoomMeetingDate: meetingDate,
  });

  // ── Step 1: Fetch Zoom audio + stream to AssemblyAI upload ──
  let aaiAudioUrl = "";
  try {
    const audioResp = await fetch(audioUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "follow",
    });
    if (!audioResp.ok) {
      await markStatus("failed", { zoomTranscriptError: `Zoom audio download returned ${audioResp.status}` });
      return new Response(JSON.stringify({ error: "Zoom audio download failed", status: audioResp.status }), { status: 502 });
    }
    const audioBuf = await audioResp.arrayBuffer();
    await markStatus("uploading", { zoomTranscriptStatusMessage: `Uploading ${(audioBuf.byteLength / 1024 / 1024).toFixed(1)}MB to AssemblyAI…` });

    const uploadResp = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { authorization: aaiKey, "content-type": "application/octet-stream" },
      body: audioBuf,
    });
    if (!uploadResp.ok) {
      const errText = await uploadResp.text().catch(() => "");
      await markStatus("failed", { zoomTranscriptError: `AssemblyAI upload returned ${uploadResp.status}: ${errText.slice(0, 200)}` });
      return new Response(JSON.stringify({ error: "AssemblyAI upload failed", status: uploadResp.status }), { status: 502 });
    }
    const uploadData = await uploadResp.json();
    aaiAudioUrl = uploadData.upload_url;
  } catch (err: any) {
    await markStatus("failed", { zoomTranscriptError: "Upload step failed: " + (err?.message || String(err)) });
    return new Response(JSON.stringify({ error: "Upload step failed: " + String(err) }), { status: 500 });
  }

  // ── Step 2: Kick off transcription ──
  await markStatus("transcribing", { zoomTranscriptStatusMessage: "AssemblyAI is transcribing (typically 2-5 min)…" });
  const transcribeResp = await postJson(
    "https://api.assemblyai.com/v2/transcript",
    { authorization: aaiKey },
    {
      audio_url: aaiAudioUrl,
      speaker_labels: true, // diarisation: "Phoebe:" vs client
      punctuate: true,
      format_text: true,
      language_code: "en_au",
    }
  );
  if (!transcribeResp.ok || !transcribeResp.data.id) {
    await markStatus("failed", { zoomTranscriptError: "AssemblyAI transcript-create failed: " + JSON.stringify(transcribeResp.data).slice(0, 200) });
    return new Response(JSON.stringify({ error: "AssemblyAI transcript-create failed", data: transcribeResp.data }), { status: 502 });
  }
  const transcriptId = transcribeResp.data.id;

  // ── Step 3: Poll until complete (or 12 min timeout) ──
  const startMs = Date.now();
  const maxMs = 12 * 60 * 1000;
  let final: any = null;
  while (Date.now() - startMs < maxMs) {
    await new Promise((res) => setTimeout(res, 5000));
    const pollResp = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: aaiKey },
    });
    if (!pollResp.ok) {
      await markStatus("failed", { zoomTranscriptError: `Poll returned ${pollResp.status}` });
      return new Response(JSON.stringify({ error: "Poll failed", status: pollResp.status }), { status: 502 });
    }
    const pollData = await pollResp.json();
    if (pollData.status === "completed") { final = pollData; break; }
    if (pollData.status === "error") {
      await markStatus("failed", { zoomTranscriptError: "AssemblyAI error: " + (pollData.error || "unknown") });
      return new Response(JSON.stringify({ error: "AssemblyAI error", details: pollData.error }), { status: 502 });
    }
    // queued | processing — keep polling
  }
  if (!final) {
    await markStatus("failed", { zoomTranscriptError: "AssemblyAI timed out after 12 min" });
    return new Response(JSON.stringify({ error: "AssemblyAI timed out" }), { status: 504 });
  }

  // ── Step 4: Format transcript with speaker labels ──
  let transcriptText = "";
  if (Array.isArray(final.utterances) && final.utterances.length) {
    transcriptText = final.utterances
      .map((u: any) => `${u.speaker || "Speaker"}: ${u.text}`)
      .join("\n\n");
  } else {
    transcriptText = (final.text || "").trim();
  }
  if (!transcriptText) {
    await markStatus("failed", { zoomTranscriptError: "AssemblyAI returned empty transcript" });
    return new Response(JSON.stringify({ error: "Empty transcript" }), { status: 422 });
  }

  // ── Step 5: Save to client + log activity ──
  try {
    const raw = await store.get(clientId);
    if (raw) {
      const client = JSON.parse(raw);
      client.zoomTranscript = transcriptText;
      client.zoomTranscriptSource = "assemblyai";
      client.zoomTranscriptFetchedAt = new Date().toISOString();
      client.zoomTranscriptStatus = "completed";
      client.zoomTranscriptStatusMessage = `✓ ${transcriptText.length.toLocaleString()} chars · AssemblyAI`;
      if (meetingTopic) client.zoomMeetingTopic = meetingTopic;
      if (meetingDate) client.zoomMeetingDate = meetingDate;
      await store.set(clientId, JSON.stringify(client));

      // Push to activity log so coach sees notification
      try {
        const logRaw = await activityStore.get("log");
        const log = logRaw ? JSON.parse(logRaw) : [];
        log.unshift({
          id: "act-aai-" + Date.now(),
          kind: "transcript",
          title: "AssemblyAI transcript ready for " + (client.name || "client"),
          body: `${transcriptText.length.toLocaleString()} characters · ${meetingTopic || "Session"}`,
          ref: { clientId },
          ts: new Date().toISOString(),
        });
        await activityStore.set("log", JSON.stringify(log.slice(0, 500)));
      } catch (logErr) {
        console.error("[transcribe-large-audio-bg] activity log push failed:", logErr);
      }
    }
  } catch (err) {
    console.error("[transcribe-large-audio-bg] save failed:", err);
  }

  return new Response(JSON.stringify({
    ok: true,
    transcriptId,
    characterCount: transcriptText.length,
    source: "assemblyai",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};
