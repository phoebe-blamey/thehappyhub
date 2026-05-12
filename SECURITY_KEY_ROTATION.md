# API Key Rotation Guide

**Audience: Phoebe (and anyone helping her admin the platform)**

CLAUDE.md notes that **Anthropic API key + Google OAuth Client Secret + Google refresh token** were exposed in chat history during the build. These must be rotated. Other keys should be rotated quarterly as good practice.

Each section below is a 5–10 minute job in the relevant provider's dashboard.

After rotating each key, you must update the matching env var in Netlify:
**Site settings → Environment variables** at https://app.netlify.com/sites/the-happy-hub/configuration/env

---

## 🔴 ROTATE NOW — exposed in chat history

### 1. `ANTHROPIC_API_KEY` (powers all AI features)

1. Go to https://console.anthropic.com/settings/keys
2. Click **Create Key** → name it `happy-hub-2026-05` → copy the new key (it starts with `sk-ant-api03-…`)
3. In Netlify env vars, edit `ANTHROPIC_API_KEY` → paste the new value → Save
4. Trigger a redeploy (Site → Deploys → Trigger deploy → Deploy site)
5. Wait ~60 s, then test: open hub, click ⚡ Generate plan or ✦ Generate research brief
6. Once confirmed working, return to console.anthropic.com → **Revoke** the old key

### 2. `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN` (Gmail send-as)

1. Go to https://console.cloud.google.com/apis/credentials → select the OAuth 2.0 Client for Happy Hub Mailer
2. Click **Reset Secret** → copy the new client secret
3. Update `GOOGLE_CLIENT_SECRET` in Netlify env vars

Now redo the OAuth flow to get a fresh refresh token:

4. Go to https://developers.google.com/oauthplayground/
5. Click the gear icon (top right) → tick **Use your own OAuth credentials** → paste the new Client ID + new Client Secret
6. In the left scope list, scroll to **Gmail API v1** → select `https://www.googleapis.com/auth/gmail.send`
7. Click **Authorize APIs** → sign in as `phoebe@phoebeblamey.com.au` → consent
8. Click **Exchange authorization code for tokens**
9. Copy the **Refresh token** field
10. Update `GOOGLE_REFRESH_TOKEN` in Netlify env vars
11. Trigger a redeploy
12. Test: from Settings → "Send test email" (or trigger the daily digest force-run)

---

## 🟡 ROTATE QUARTERLY — good hygiene

### 3. `ZOOM_CLIENT_SECRET` + `ZOOM_VERIFICATION_TOKEN`

1. Go to https://marketplace.zoom.us → **Manage** (top right) → select your **Happy Hub** app
2. Under **App Credentials**:
   - Click **Regenerate** beside **Client secret** → copy new value
   - Update `ZOOM_CLIENT_SECRET` in Netlify env vars
3. Under **Features → Event Subscriptions → Secret Token**:
   - Click **Regenerate**
   - Copy new value
   - Update `ZOOM_VERIFICATION_TOKEN` in Netlify env vars
4. Save / activate the app in Zoom Marketplace
5. Trigger a Netlify redeploy
6. Test: trigger a Zoom recording webhook, or click **Pull from Zoom** on any client

### 4. `CALENDLY_API_TOKEN` + `CALENDLY_WEBHOOK_SIGNING_KEY`

1. Go to https://calendly.com/integrations/api_webhooks
2. Click **Personal Access Tokens** → **Revoke** the old one
3. Click **+ Create token** → copy
4. Update `CALENDLY_API_TOKEN` in Netlify
5. For the webhook signing key:
   - Use the existing `POST /api/calendly-setup-webhook` endpoint (Settings → Data hygiene)
   - It generates a new signing key and registers it with Calendly
   - The endpoint also writes the new value to `CALENDLY_WEBHOOK_SIGNING_KEY` env var
6. Redeploy + test a booking

### 5. `OPENAI_API_KEY` (Whisper transcription)

1. Go to https://platform.openai.com/api-keys
2. Click your existing **happy-hub** key → **Delete**
3. Click **+ Create new secret key** → copy
4. Update `OPENAI_API_KEY` in Netlify
5. Redeploy

### 6. `ASSEMBLYAI_API_KEY` (large-audio transcription)

1. Go to https://www.assemblyai.com/app/account → API Keys
2. **Revoke** the existing key
3. **Generate new key** → copy
4. Update `ASSEMBLYAI_API_KEY` in Netlify
5. Redeploy

### 7. `QUICK_ACTION_SECRET` (HMAC for digest one-tap links + unsubscribe)

Rotating this invalidates any unread digest emails — any "mark task done" link in an unread email will no longer work. So rotate AFTER weekend (Sat/Sun) when active digest links are minimal.

1. Generate a fresh 32-byte hex secret:
   ```
   openssl rand -hex 32
   ```
2. Update `QUICK_ACTION_SECRET` in Netlify env vars → paste the new value
3. Redeploy
4. Test: trigger a manual digest (Settings → Send digest now), open the email, click a "✓ Mark done" link → should succeed

### 8. `INTERNAL_CRON_SECRET` (internal server-to-server auth)

Rotating this invalidates any in-flight cron jobs at the moment of rotation. Safe to do anytime — the next scheduled run uses the new value automatically.

1. `openssl rand -hex 32`
2. Update `INTERNAL_CRON_SECRET` in Netlify env vars
3. Redeploy

### 9. `COACH_ADMIN_PIN`

If you ever want to change your coach PIN:

1. Pick a new PIN (12+ chars recommended, mix of letters / numbers / symbols)
2. Update `COACH_ADMIN_PIN` in Netlify env vars
3. Redeploy
4. On every device where you sign into the hub: clear the saved PIN (Settings → Change PIN) or just enter the new value on next login

---

## ✅ Verification checklist after any rotation

- [ ] Old key shown as **revoked / deleted** in the provider's dashboard
- [ ] New key set in Netlify env vars (Site → Settings → Env vars)
- [ ] Site redeployed (Deploys → Trigger deploy)
- [ ] `https://hub.phoebeblamey.com.au/api/integrations-status` shows the affected integration as `true`
- [ ] One end-to-end test (send a digest, pull a transcript, etc.) succeeds

If anything stops working after a rotation, the most likely cause is one env var mismatch — double-check the value in Netlify matches what the provider's dashboard shows.

---

## Where to find a key value if you've lost it

You can re-read any env var (except the value of `is_secret:true` ones, which mask on read) via:
- Netlify dashboard → Site settings → Environment variables → click "View"
- Or via Netlify CLI: `netlify env:list --site=the-happy-hub`

If a key is truly lost (deleted in provider's dashboard AND no copy in Netlify), follow the rotation steps above to issue a fresh one.
