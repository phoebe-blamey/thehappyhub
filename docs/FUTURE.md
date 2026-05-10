# Future version list — The Happy Hub

Things that have been built or partly-built but pulled from the live UI,
plus things on the roadmap that aren't blocking real-client use yet.

---

## Pulled, queued for restore

### Dark mode (theme toggle)

- **Status:** code present, button hidden in v11715
- **Where it lives:** `toggleTheme()` + `[data-theme-toggle]` hooks in
  `public/index.html` (around line 2541), CSS variables in
  `public/styles.css`
- **Why it was pulled:** rendering wasn't reliable. Several surfaces had
  hard-coded light backgrounds (form fields, cohort panel, client
  portal hero) so flipping to dark left orphan light blocks. Some text
  also became unreadable due to `color:var(--magenta)` against a dark
  paper variable.
- **What's needed to restore:**
  1. Audit every inline `style=` and per-element CSS rule for
     hard-coded colours; convert to CSS variables.
  2. Add an explicit dark-mode override block for:
     - `.access-card`, `.client-hero`, `.intake-q-card`
     - all `<input>` / `<textarea>` / `<select>` defaults
     - `.cohort-mgr-pane` and the cohort member cards
     - `.client-section`, `.custom-sec-card`
     - branded modal body + actions
  3. Test on both coach and client portals end-to-end before
     re-enabling the button.
- **How to put the button back:** uncomment the two `<button data-theme-toggle ...>`
  lines in `public/index.html` (one in coach topbar near line 130,
  one in client topbar near line 1178). The JS already wires up.

---

## On the roadmap (from CLAUDE.md "Known issues")

These are Phoebe-side actions, not coding work:

- Rotate `ANTHROPIC_API_KEY` (was exposed in chat history during build)
- Rotate Google OAuth Client Secret + refresh token after first
  successful Gmail send
- WhatsApp Business API — UI is shipped; goes live once Phoebe finishes
  Meta Business setup and adds env vars `WHATSAPP_PHONE_NUMBER_ID` /
  `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_VERIFY_TOKEN`
- Stripe Standard — UI is shipped; goes live with `STRIPE_SECRET_KEY` /
  `STRIPE_PUBLISHABLE_KEY` (+ optional `STRIPE_WEBHOOK_SECRET`)
- Twilio SMS — env detection wired; activates with `TWILIO_ACCOUNT_SID` /
  `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`
- End-to-end real client test — Calendly → AI Research Brief → first
  session → Zoom transcript → AI summary → review queue → publish →
  wins logged

---

## Nice-to-have (not blocking)

- Tighten the PHOEBE_VOICE block with a few example outputs so the AI
  email-draft assistant lands consistently on tone
- Add re-import of the JSON backup (export already works in Settings →
  Maintenance)
- Per-client "Recent activity" panel in coach view of a client (the
  global activity feed exists; per-client would be a useful drill-down)
- Live cohort member online indicators in Community tab
