# The Happy Hub — Claude Code Context

> This file primes Claude Code on every session. Read it first before doing anything.

## Who this is for

**Phoebe Blamey** — business coach. Australian English. Warm, direct, no jargon, no corporate-speak. She is the sole user of the coach portal. Her clients use the client portal.

Website: https://phoebeblamey.com.au

## What this is

A custom coaching platform that automates Phoebe's **90-Day Business Breakthrough** program. Replaces a manual workflow that previously lived across Calendly, Zoom, Google Sheets, and her head.

End-to-end flow it automates:
1. Client books 2-hr business audit via Calendly → webhook auto-creates client file with social profiles populated by AI
2. Phoebe runs AI Research Brief before the call (deep industry-expert analysis with red flags)
3. Zoom call happens, transcript pulled automatically into the platform
4. AI builds 90-day plan from transcript for Phoebe to review and tweak
5. Tasks tracked, check-ins triggered, wins logged, revenue measured
6. Cohort view groups graduates into MDC for ongoing community

## Live URLs

- **Production (canonical):** https://hub.phoebeblamey.com.au — primary URL Phoebe sends to clients
- **Production (Netlify default):** https://the-happy-hub.netlify.app — still works, both serve the same site
- **WordPress redirect:** https://phoebeblamey.com.au/login → bounces to hub.phoebeblamey.com.au, preserves `?client=XXX` query
- **GitHub:** https://github.com/phoebe-blamey/thehappyhub
- **Netlify project:** the-happy-hub (site ID `a5871e51-a1bb-435a-b2f8-c80b0b6cc230`)
- **DNS:** SiteGround manages all DNS for phoebeblamey.com.au; `hub` is a CNAME → `the-happy-hub.netlify.app`. Don't change nameservers — would break the main site + email.
- **Old/deprecated Netlify:** phoebe-breakthrough-hub (site ID `fc6283a5-68a5-491c-b013-d9a87ef35b1b`) — do not deploy here

## Architecture

Single-page app, no build step. Pure HTML/CSS/JS in `public/index.html`. Netlify Functions for backend. Netlify Blobs for persistent storage.

```
public/
  index.html          # entire frontend — landing, coach portal, client portal, all pages, all logic
netlify/
  functions/
    calendly-webhook.mts                # auto-creates client on Calendly booking
    save-client.mts                     # POST → Netlify Blobs
    get-clients.mts                     # GET ← Netlify Blobs
    ai-call.mts                         # server-side Anthropic proxy (uses ANTHROPIC_API_KEY env var)
    zoom-transcript.mts                 # pulls Zoom recording transcripts via Server-to-Server OAuth
    seed-clients.mts                    # one-shot real client seed (Anna-Louise, Louise, Yvette, Frances, Kari, Christine, Julie)
    get-notifications.mts               # new booking alerts (read + clear queue)
    send-message.mts                    # email (Resend) / SMS (Twilio) outbound
    discover-socials-background.mts     # AI pre-session brief — Netlify background fn, auto-triggered by calendly-webhook when a website/LinkedIn is provided
netlify.toml               # build config — publish dir is `public`, no build command
package.json               # function dependencies only
```

## Tech stack

- **Frontend:** vanilla HTML/CSS/JS, single file, no framework
- **Hosting:** Netlify (Pro plan)
- **Storage:** Netlify Blobs (persistent), localStorage (fallback for offline/dev)
- **Backend:** Netlify Functions (`.mts` TypeScript modules)
- **AI:** Anthropic API direct
  - `claude-haiku-4-5-20251001` — fast tasks (social discovery, task extraction)
  - `claude-sonnet-4-6` — heavy analysis (research brief, plan builder, win impact, profitability insights)
- **Calendar:** Calendly API + webhook
- **Video:** Zoom Server-to-Server OAuth (recording + transcript scopes)
- **Email:** Gmail API (sends as `phoebe@phoebeblamey.com.au`; sent emails appear in her Gmail Sent folder automatically). OAuth refresh-token flow, scope `gmail.send` only.
- **SMS:** Twilio (optional — env vars not yet set)

## Environment variables (Netlify)

Set on the `the-happy-hub` Netlify site:

| Variable | Status | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ live | All AI features. **Note: was exposed in chat history — needs rotation.** |
| `CALENDLY_API_TOKEN` | ✅ live | Calendly REST API |
| `ZOOM_ACCOUNT_ID` | ✅ live | Zoom Server-to-Server OAuth |
| `ZOOM_CLIENT_ID` | ✅ live | Zoom Server-to-Server OAuth |
| `ZOOM_CLIENT_SECRET` | ✅ live | Zoom Server-to-Server OAuth |
| `ZOOM_VERIFICATION_TOKEN` | ✅ live | Zoom webhook **Secret Token** — used to verify the URL handshake AND the HMAC signature on every event. Must match the Secret Token shown in Zoom Marketplace → Happy Hub app → Feature → Event Subscriptions. **Regenerate any time it leaks.** |
| `GOOGLE_CLIENT_ID` | ✅ live | OAuth Client ID for Gmail API. **Was exposed in chat history during setup — rotate after first end-to-end test passes.** |
| `GOOGLE_CLIENT_SECRET` | ✅ live | OAuth Client Secret. Same exposure note as above. |
| `GOOGLE_REFRESH_TOKEN` | ✅ live | OAuth refresh token tied to phoebe@phoebeblamey.com.au with `gmail.send` scope only. Same exposure note. |
| `GOOGLE_SENDER_EMAIL` | ✅ live | The "From" address: `phoebe@phoebeblamey.com.au`. Not secret. |
| `TWILIO_*` | ⏳ optional | Outbound SMS |

**Never commit secrets to the repo. Never echo them in code or logs.**

## Zoom Server-to-Server OAuth scopes required

The Happy Hub app needs the following scopes (all `:master` variant since
the app is account-level). These are checked under Marketplace → Happy Hub →
Scopes:

| Scope | Used by |
|---|---|
| `meeting:write:meeting:master` | Creating cohort + per-client Zoom meetings (`/api/zoom-create-meeting`, `/api/zoom-create-template`) |
| `meeting:read:meeting:master` | Looking up meetings during webhook auto-pull and template verification |
| **`meeting:write:template:master`** | **Saving a meeting as a user template (POST `/users/me/meeting_templates`).** This is the scope that returned `4711 Invalid access token, does not contain scopes` during the v10000 smoke test. Add this BEFORE running zoom-create-template. |
| **`meeting:write:template:admin`** | Same as above for admin context. Belt-and-braces — Zoom's docs aren't crystal-clear which one their endpoint actually checks, so enable both. |
| `account:write:meeting_template:master` | Account-level meeting templates (different from user templates above; both should be enabled). |
| `meeting:write:meeting:admin` | (optional but recommended) Admin variant of the create-meeting scope. |
| `cloud_recording:read:list_user_recordings:master` | Listing recent recordings on the Settings page |
| `cloud_recording:read:recording:master` | Fetching a specific recording's files (`/api/zoom-transcript`, webhook) |
| `cloud_recording:read:content:master` | Reading transcript file contents |
| `meeting:write:invite_links:master` | (optional) Creating invite links |
| `meeting:write:meeting:master` (delete) | Implied — also lets us roll back a seed meeting if a template-save fails halfway through |

Webhook event subscriptions (Marketplace → Happy Hub → Feature):

| Event | Used for |
|---|---|
| `recording.completed` | Auto-pull transcript + AI-summarise + queue for review |
| `meeting.ended` | (optional) Acknowledged silently — useful future signal |

**Webhook endpoint URL**: `https://hub.phoebeblamey.com.au/api/zoom-webhook`

## Auth model

- **Coach portal** locked behind PIN `PB2025`
- **Client portal** accessed via individual codes (e.g. `JAME24`, `SARA31`, `ELOD99` for the Elodie test client)
- No real user accounts — Phoebe is the only privileged user

## Real clients seeded

Louise Syphers, Yvette Polley, Frances Pratt, Kari Marsden, Christine Lukich, Julie Judge — plus `ELOD99` (Elodie Blamey, test). Pulled in via the Settings → "Import Calendly clients" button or `seed-clients` function.

## Major features built

- **🛠 Tools tab** — first tab on every client. Quick AI actions, session prep, comms, tracking, smart alerts.
- **💛 The Happy Hub** — resource library with share-to-client
- **✅ Task Sheet** — cross-client task view with filter pills (All open / Coach only / Client visible / Overdue / Completed). Auto-suggests check-ins for clients silent 7+ days.
- **📊 Revenue dashboard** — referral leaderboard, client highlights, profitability tracker (default rate $297 AUD/hr)
- **💡 MDC Cohort view + Cohort Manager** — assign clients, broadcast email/SMS, WhatsApp links
- **Wins tracker** — before/after metrics, AI impact statements
- **12 per-program tabs**, multi-program client profiles, health scoring
- **Floating Review drawer** — inline copy editing, saves to localStorage, compile-feedback button copies all changes to clipboard
- **AI fetch interceptor** — tries `/api/ai-call` first (server-side, secure), falls back to direct browser→Anthropic if functions aren't deployed (saves API key to localStorage on first prompt)

## Known issues / open roadmap

In rough priority order:

1. **Rotate the Anthropic API key.** Visible in chat history during the build. Generate a new one at console.anthropic.com → update Netlify env var → done.
2. **Rotate the Google OAuth Client Secret + refresh token** after first successful Gmail send. To rotate: console.cloud.google.com → APIs & Services → Credentials → reset secret on the Happy Hub Mailer client; redo the OAuth Playground step; update both env vars in Netlify.
3. **WhatsApp Business API** — UI shipped (Settings card with setup instructions, message queues stored on cohorts). Becomes live once Phoebe completes Meta Business setup + adds env vars `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_VERIFY_TOKEN`.
4. **Stripe Standard** — UI shipped (Settings card with setup instructions, Phoebe-defined products surface on client recommendation card). Live checkout activates with env vars `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` (+ optional `STRIPE_WEBHOOK_SECRET`).
5. **Twilio SMS** — env var detection wired (`TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_FROM_NUMBER`); UI shows status pill in Settings.
6. **End-to-end real client test** — Calendly → AI Research Brief → first session → Zoom transcript → AI summary → review queue → publish → wins logged. Test once secrets are rotated.

## Style and tone for everything Phoebe-facing

- Australian English spellings (organise, prioritise, colour, programme→program, cosy)
- Warm, direct, conversational. No corporate jargon. No "leverage", "synergy", "ecosystem", "robust".
- Clients are people, not "users". Phoebe is "Phoebe" or "you", not "the coach".
- Currency: AUD with `$` prefix (default rate $297 AUD/hr)
- Dates: `8 May 2026` format, not US `5/8/2026`
- 24-hour time NOT preferred — she wants `9:30am`, `2:00pm`

## Code conventions

- **One file rules.** `public/index.html` holds everything intentionally. Don't split it into modules unless there's a strong reason.
- **No frameworks.** No React, no Vue, no build step. Plain ES6+ in `<script>` tags.
- **Function naming:** verbs for actions (`renderTaskSheet`, `seedRealClients`), nouns for data (`MDC_COHORTS`, `clients`).
- **CSS:** custom properties at top of `<style>`, BEM-ish class naming, no Tailwind.
- **Version stamp:** there's a `vNNNN` build tag in the topbar — bump it on every deploy so Phoebe can verify the new version is live.
- **Console logging:** `[FeatureName]` prefix on logs (e.g. `[TaskSheet] gathered 17 items`) — useful when debugging from her browser console screenshots.

## Deploy workflow

1. Edit files locally (you, Claude Code, are now doing this directly)
2. `git add` + `git commit` with a clear message
3. `git push origin main`
4. Netlify auto-deploys in ~60 seconds — both static files AND functions
5. Verify by checking the version stamp in the topbar at https://hub.phoebeblamey.com.au (or the netlify.app URL — both serve the same site)

**Important:** Drag-and-drop deploys ONLY upload static files, not functions. Always push via Git so functions deploy too.

## Things to never do

- Never commit secrets, API keys, or env var values to the repo
- Never delete client data from Netlify Blobs without explicit confirmation
- Never change the coach PIN or client access codes without telling Phoebe
- Never deploy to the old `phoebe-breakthrough-hub` Netlify site
- Never use US English spellings in user-facing copy
- Never sign Phoebe up for paid services (Resend free tier, Twilio pay-as-you-go are fine — but she sets up the accounts herself)

## How to talk to Phoebe

She's not a developer. She's smart and learns fast, but:
- Don't dump terminal output unless asked
- Explain what a command does before suggesting she run it
- If something fails, say what failed in plain English before showing the error
- When proposing a change, describe the user-visible effect first, then the technical implementation
- She's been through enough deploy chaos already — when something works, say so clearly so she knows it worked
