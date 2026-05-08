---
name: deploy
description: Deploy The Happy Hub to production at https://hub.phoebeblamey.com.au. Auto-invoke when the user says "Deploy updates", "Deploy this", "Deploy now", "Push live", "Ship it", "Push to main", or any clear request to push the current local state of the thehappyhub project to GitHub for Netlify auto-deploy. Bumps the vNNNN stamp in public/index.html, commits, pushes, and verifies the live site picks up the new version.
---

# Deploy The Happy Hub

Run a full deploy of the current local state of `thehappyhub` to https://hub.phoebeblamey.com.au (the canonical Netlify URL https://the-happy-hub.netlify.app also serves the same site).

## Steps

1. **Find the current version stamp.** Lives in `public/index.html` as a string matching `v\d{4,5}`. Use Grep with pattern `v[0-9]{4,5}` and `output_mode: "count"` first to confirm there are exactly **2** occurrences (one in the topbar deploy banner around line 380, one in the success console log).
   - If 0 occurrences: STOP and tell the user the version stamp is missing — don't invent one.
   - If more than 2: STOP and ask the user which to bump.

2. **Bump it by 1.** E.g. `v7704` → `v7705`. Use `Edit` with `replace_all: true` so both occurrences move together.

3. **Stage all changes:** `git add .` (run from the project root).

4. **Commit.** If the user's prompt included a description of what changed (e.g. "Deploy updates: fix typo on landing page"), use that as the commit message. Otherwise use `Deploy v<new-number>`.

5. **Push:** `git push`.
   - If push is rejected ("non-fast-forward"), run `git pull --rebase` once and try again.
   - Do NOT force-push without asking the user first.

6. **Poll the live site** for the new version stamp:
   ```
   curl -s https://hub.phoebeblamey.com.au/ | grep -oE "v[0-9]{4,5}" | head -1
   ```
   Check every 15 seconds for up to 6 attempts (~90 seconds total). Stop as soon as you see the new version.

7. **Report back** in one or two short lines (per CLAUDE.md "don't dump terminal output unless asked"):
   - On success: `✓ v7705 is live. Commit abc1234. Took ~Xs.`
   - If polling times out: `Pushed abc1234 to GitHub, but the new version hasn't appeared on the live site after 90s. Check the Netlify deploy log at https://app.netlify.com/sites/the-happy-hub/deploys.`

## Constraints

- **Never commit secrets.** `.gitignore` already blocks `.env*`, but if you spot anything that looks like an API key (`sk-...`, `pk_...`, long hex strings) in the staged diff, STOP and warn the user.
- **Never deploy to the deprecated `phoebe-breakthrough-hub` site** (per CLAUDE.md). The remote in this repo points to the right place; don't change it.
- **Don't change the coach PIN, client access codes, or seeded client data** as part of a "deploy" — those are content changes that need explicit Phoebe approval.
- **Don't auto-invoke when the user is just discussing or planning a change** — only when the intent is clearly "push it live now."
