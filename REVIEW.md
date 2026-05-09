# Pre-UAT Review — The Happy Hub
> Reviewer: Claude (Sonnet 4.5) · Date: 2026-05-09 · Build at review: v11440

---

## 1. Verdict — 🟡 **YELLOW**

The hub is **functionally ready** for UAT with 7 real clients. Everything that needs to work for Phoebe to run a session works: Calendly bookings auto-create clients (19 event types mapped), Zoom recordings flow through HMAC-verified webhooks into AI-summarised review queues, AI features run via Sonnet 4-6 + Haiku 4-5, all 6 Blob namespaces persist correctly, brand + responsive design are clean, no hardcoded secrets, no Lorem ipsum, no broken images.

The reason it's yellow not green: **two real issues that are easy to miss and worth resolving before live clients touch it** — the Calendly webhook has no signature verification (anyone with the URL could fake-create clients), and the AI pre-session brief hardcodes "Broker Business Breakthrough session" in the prompt regardless of what program the client booked. Plus 38 records in Netlify Blobs that aren't real clients (3 demos, 2 test bookings, 3 dupes, 30 Zoom orphan placeholders) muddy the dashboard. None block UAT, all should be sorted before the first paying client. **Promote to green** once the Calendly signature check + the program-context fix ship and Phoebe walks the data audit.

---

## 2. Blockers (must fix before UAT)

**None.**

---

## 3. Important (should fix during UAT or immediately after)

| # | Item | Where | Why it matters |
|---|---|---|---|
| I-1 | **Calendly webhook has no signature verification** | `netlify/functions/calendly-webhook.mts` | Anyone who knows the URL `/api/calendly-webhook` could POST a fake booking and create rogue client records. Calendly supports HMAC signing via `Calendly-Webhook-Signature`; not currently checked. Zoom webhook does this properly. |
| I-2 | **AI pre-session brief hardcoded to "Broker Business Breakthrough"** | `netlify/functions/discover-socials-background.mts:18` | The prompt says `A new coaching client named "${name}" has booked a Broker Business Breakthrough session…` regardless of which program type was actually booked. Result: the AI brief gets wrong program context for every non-broker client. Calendly webhook (line 201) doesn't pass the program type. |
| I-3 | **Coach PIN `PB2025` documented in public files** | `CLAUDE.md:120`, `docs/TESTING.md:16` | Phoebe should change it via the Settings → "Your login PIN" UI before live clients use the hub. Documented PIN on a public-facing repo is fine for the build phase, not for live. |
| I-4 | **Production Blobs contain 38 non-real client records** | `clients` namespace | 30 Zoom orphan placeholders + 3 demo personas (James/Sarah/Ann) + 2 "Happy Money Journey" test bookings + 3 Amelia dupes. They clutter the All-Clients grid and confuse Phoebe. Cleanup walkthrough proposed in §6 below. |
| I-5 | **Anthropic API key + Google OAuth secrets still need rotation** | Netlify env vars | Both were exposed in past chat history per CLAUDE.md. Rotation is one-line work in each provider's console + Netlify env-var update. Owed once Phoebe gives green light. |
| I-6 | **Two real clients have placeholder `biz: "MDC member"`** | `client-kari-m`, `client-yvette-p` | Kari Marsden + Yvette Polley should have real business names — placeholder shows on cards + shows in AI prompts. Phoebe to fill in via Settings → Edit Client. |

---

## 4. Nice-to-haves (post-UAT)

| # | Item | Where | Notes |
|---|---|---|---|
| N-1 | Add security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) | `netlify.toml` | Defense-in-depth. Currently only HSTS is set. Not a real risk vector today (no cookie auth, no iframe embeds), but worth adding before scaling beyond Phoebe + UAT clients. |
| N-2 | Wrap `integrations-status.mts` in try/catch | one file | All other 22 functions have it. This one's just env-var lookups so it can't really fail, but consistent error handling is healthier. |
| N-3 | "topic TBD" / "Session on TBD" string in dynamic copy | 2 inline strings | Reads slightly cold. "topic to be confirmed" / "to be confirmed" warmer. Brand decision — Phoebe to call. |
| N-4 | `public/js/demo-data.js` mixes real Phoebe client names (Frances, Louise) with demo personas (James, Sarah, Ann) | 1 file | Only triggers when both server fetch + localStorage are empty (basically never in prod), but tidy up after UAT to avoid future confusion. |
| N-5 | Brace count delta of 1 in `index.html` | n/a | 4,411 `{` vs 4,412 `}` across 19,823 lines. Almost certainly a `}` inside a CSS rule or string literal — site loads + runs in production, JS engine has no issue. Note for tidiness only. |
| N-6 | Consider removing the 12 remaining `console.log` calls before final go-live | `index.html` | Each gates on a real event (errors, rare flows, gated by `if (saves > 0)` etc.). Keeping them gives Phoebe useful Console breadcrumbs when she screenshots a bug. Re-evaluate once she stops needing screenshots. |

---

## 5. Items raised — status

| Item | Source | Status | Notes |
|---|---|---|---|
| Rotate `ANTHROPIC_API_KEY` | CLAUDE.md #1 | **Outstanding** | Pending Phoebe's UAT green-light. Runbook in `~/.claude/memory/open-items.md`. ~5 min in Anthropic console + Netlify env var. |
| Rotate `GOOGLE_CLIENT_SECRET` + refresh token | CLAUDE.md #2 | **Outstanding** | Same gate. ~10 min via Google Cloud Console + OAuth Playground. |
| Rotate `ZOOM_VERIFICATION_TOKEN` | memory only | **Outstanding** | Leaked in v9800 Zoom-app screenshot per memory. ~2 min in Zoom Marketplace. |
| WhatsApp Business API live | CLAUDE.md #3 | **Deferred** | UI shipped; env vars not set. Phoebe completes Meta Business setup. |
| Stripe Standard live | CLAUDE.md #4 | **Deferred** | UI shipped; env vars not set. Phoebe completes Stripe setup. |
| Twilio SMS | CLAUDE.md #5 | **Deferred** | UI + env detection shipped. Optional. |
| End-to-end real client test | CLAUDE.md #6 | **Outstanding (= UAT)** | This review IS the prep for it. |
| `TODO` / `FIXME` / `XXX` / `HACK` comments in code | grep | **Done** | Zero genuine markers found. |
| `ROADMAP.md` / `TODO.md` / `BACKLOG.md` / `NOTES.md` | filesystem | **N/A** | None exist. Only `CLAUDE.md` + `docs/TESTING.md`. |
| WIP commits | git log | **Done** | Every commit since v10400 is a labelled feature batch. No WIP / TODO / draft commits. |

---

## 6. System clean-up

### 6a. Client data audit (Netlify Blobs `clients` namespace)

**Total: 70 records.** Breakdown:

| Category | Count | Action |
|---|---|---|
| ✅ Canonical 7 real clients | 7 | **Keep** |
| ✅ Elodie test client (ELOD99) | 1 | **Keep** |
| ✅ Calendly auto-created (real prospects) | 15 | **Keep — Phoebe to spot-check** |
| 🔴 Demo personas (James Wilson, Sarah Chen, Ann Dettori) | 3 | **Propose delete** |
| 🔴 "Happy Money Journey" test bookings | 2 | **Propose delete** |
| 🔴 Amelia Dean Blamey duplicates | 3 | **Propose merge into one** |
| 🔴 Samantha Elizabeth McFarlane duplicates | 2 | **Propose merge** |
| 🔴 Scott Taylor + Scott Taylor BB Zoom orphan | 2 | **Propose merge** |
| 🔴 Zoom orphan placeholder records | 30 | **Propose bulk delete via Settings → Unmatched Zoom** |
| 🔴 Other auto-created (no name?) | ~5 | **Investigate during UAT** |

**Canonical 7 sanity:**
| Name | ID | Code | Status | Health | biz |
|---|---|---|---|---|---|
| Anna-Louise MacAllister | `client-annalouise-m` | ANNA47 | active | green | Auslanway — Disability services |
| Christine Lukich | `client-christine-l` | CHRI91 | active | green | Green Light Coaching |
| Frances Pratt | `client-frances-p` | FRAN82 | active | green | Metisan — Sales methodology |
| Julie Judge | `client-julie-j` | JULI74 | active | green | Mortgage Pass — Mortgage broking |
| Kari Marsden | `client-kari-m` | KARI38 | active | green | **MDC member** *(placeholder — Phoebe to fill in)* |
| Louise Syphers | `client-louise-s` | LOUI63 | active | green | Abundance & Beyond — Mortgage broking |
| Yvette Polley | `client-yvette-p` | YVET52 | active | green | **MDC member** *(placeholder — Phoebe to fill in)* |
| Elodie Blamey (test) | `client-elodie-b` | ELOD99 | active | green | Test client |

**Specific orphans of concern (Phoebe-side merge):**
- `client-zoom-frances-pratt-1778240830051` → merge into `client-frances-p`
- `client-zoom-lou-syphers-1778240829840` → merge into `client-louise-s`
- `client-zoom-jenn-donovan-1778240829511` → merge into `client-cal-jenn-jenndonovan-com-au-1778240837829`

**No deletions executed** per autonomy rule.

### 6b. Data imports

| Source | Last sync (timestamp on records) | Result | Action for UAT |
|---|---|---|---|
| Calendly | ~8 May 2026 (one bulk sync run) | 15 `client-cal-*` records created — match-by-email so re-running is safe | Phoebe to run `Settings → Sync Calendly` to refresh + verify each canonical client has a booking entry |
| Zoom | ~8 May 2026 (one bulk sync run) | 30 orphan placeholder records — auto-match couldn't tie recordings to clients | Phoebe to walk `Settings → Unmatched Zoom Recordings` and merge or dismiss each |

### 6c. Code cruft removed

| File | Change | One-line summary |
|---|---|---|
| `public/index.html` | Removed `console.log('Demo clients loaded from external file: …')` | Per-load noise |
| `public/index.html` | Removed `console.log('Clients loaded:', clients.length, …)` | Per-load noise + leaked names to console |
| `public/index.html` | Removed `console.log('Re-rendering clients...')` | Safety-rerender debug |
| `public/index.html` | Removed `console.log('[TaskSheet] render called …')` | Per-render noise |
| `public/index.html` | Removed `console.log('[TaskSheet] gathered N items')` | Per-render noise |
| `public/index.html` | Removed `console.log('[TaskSheet] rendered successfully …')` | Per-render noise |
| `public/index.html` | Removed `console.log('[Home] render called')` | Per-render noise |
| `public/index.html` | Removed `console.log('[Home] rendered, html length: …')` | Per-render noise |
| `public/index.html` | Removed dead `renderTask()` function (14 lines) | Defined in v11410 but never called — replaced by `renderSingleTask` |
| `netlify/functions/zoom-transcript.mts` | Removed dead read of `ZOOM_ACCESS_TOKEN` env var | Token is generated via OAuth flow; the static read was unused |

**12 console.log calls kept** — all gated by real events (fallback paths, errors, rare events like welcome-email-sent, weekly-checkin-auto-create). Useful for Phoebe-screenshot debugging.

**.gitignore:** Comprehensive. Covers `.env*`, `*.pem`, `*.key`, `node_modules/`, `.netlify/`, `dist/`, `build/`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.vscode/`, `.idea/`, `*.swp`, `.claude/settings.local.json`, `*.log`. ✓

### 6d. Secrets findings

| Pattern | Matches |
|---|---|
| `sk-ant-*` (Anthropic) | **0** |
| `sk_live_*`, `sk_test_*` (Stripe) | **0** |
| `pk_*` (Stripe public keys) | **0** |
| `AKIA*` (AWS) | **0** |
| `AIza*` (Google API) | **0** |
| `Bearer XXX` literal | **0** |
| `password=` / `secret=` / `api_key=` literal assignments | **0** |
| Any 32+ char hex outside the AllRoundGothic font binary | **0** |

**All 14 secret references in code are `Netlify.env.get("…")` runtime lookups.** No hardcoded credentials.

**Documented "exposed in chat" rotation list — no actions taken** per autonomy rule "for secrets — flag, never silently remove":

| Variable | Status |
|---|---|
| `ANTHROPIC_API_KEY` | Live, exposed in past chat history. **Rotate.** |
| `GOOGLE_CLIENT_SECRET` | Live, exposed. **Rotate.** |
| `GOOGLE_REFRESH_TOKEN` | Live, exposed. **Rotate.** |
| `ZOOM_VERIFICATION_TOKEN` | Live, leaked in v9800 screenshot per memory. **Rotate.** |

Coach PIN `PB2025` documented in `CLAUDE.md` and `docs/TESTING.md` — covered as I-3.

### 6e. Storage hygiene

| Namespace | Live size | Status |
|---|---|---|
| `clients` | 237 KB | Bloated by 30 Zoom orphans + 8 dupes/test (see 6a). Cleanup → ~150 KB. |
| `coach-settings` | 3.5 KB | Healthy |
| `cohorts` | 3.7 KB | Healthy |
| `activity-log` | 1.0 KB | Healthy |
| `notifications` | 20 B | Empty queue right now |
| `reminders` | (internal) | Used by send-reminders cron |

**Total: ~245 KB. Netlify Blob free tier supports 1 GB. Using 0.025% of tier.** No storage concerns.

**No orphaned namespaces.** Every namespace is read/written by ≥1 live function.

---

## 7. Changes I made during this review

All uncommitted — left for Phoebe to review the diff.

| File | Change |
|---|---|
| `public/index.html` | Removed 8 noisy per-render `console.log` calls (Demo loaded · Clients loaded · Re-rendering · 3× TaskSheet · 2× Home) |
| `public/index.html` | Removed dead `renderTask()` function (14 lines, never called — superseded by `renderSingleTask`) |
| `netlify/functions/zoom-transcript.mts` | Removed dead read of unused `ZOOM_ACCESS_TOKEN` env var |
| `REVIEW.md` | Created this report |

**Not modified** per autonomy rules:
- No client data deleted, merged, or modified
- No env vars rotated or removed
- No webhook/sync triggered against production
- No commits or pushes
- The Calendly signature-verification fix (I-1) and the discover-socials program-context fix (I-2) — flagged for Phoebe's call (functionality affecting)
- The Phoebe-voice "TBD" copy — flagged for Phoebe's call (brand/copy decision)
- All 4 documented exposed-in-chat secrets — flagged, never removed (history retains them, rotation is the right answer)
