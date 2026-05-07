---
description: Bump version stamp, commit, push to main, verify the deploy goes live on Netlify
argument-hint: [optional commit message — defaults to "Deploy vNNNN"]
---

Run a full deploy of the current local state of `thehappyhub` to https://the-happy-hub.netlify.app.

## Steps

1. **Find the current version stamp.** It lives in `public/index.html` and matches the regex `v\d{4,5}`. There should be exactly **2** occurrences — one in the topbar deploy banner (around line 380) and one in the console success log. If the count is 0 or more than 2, STOP and tell the user what you found before continuing.

2. **Bump it by 1.** E.g. `v7703` → `v7704`. Use `Edit` with `replace_all: true` so both occurrences update together.

3. **Stage all changes:** `git add .`

4. **Commit.** If `$ARGUMENTS` is non-empty, use it as the commit message. Otherwise use `Deploy v<new-number>`.

5. **Push:** `git push`. If push is rejected ("non-fast-forward"), run `git pull --rebase` once and try again. Do NOT force-push without asking the user first.

6. **Poll the live site** for the new version stamp. Use:
   ```
   curl -s https://the-happy-hub.netlify.app/ | grep -oE "v[0-9]{4,5}" | head -1
   ```
   Check every 15 seconds for up to 6 attempts (~90 seconds total). Stop as soon as you see the new version.

7. **Report back.** Per CLAUDE.md ("don't dump terminal output unless asked"), keep it clean:
   - On success: "✓ v7704 is live. Commit `abc1234`. Took ~Xs."
   - If polling times out: "Pushed `abc1234` to GitHub, but the new version hasn't appeared on the live site yet. Check the Netlify deploy log at https://app.netlify.com/sites/the-happy-hub/deploys before assuming it worked."

## Constraints

- Never commit secrets. The `.gitignore` already blocks `.env*`, but if you spot anything that looks like an API key (`sk-...`, `pk_...`, long hex strings) in the staged diff, STOP and warn the user.
- Never deploy to the old `phoebe-breakthrough-hub` site (per CLAUDE.md — the remote in this repo points to the right place, but be alert).
- Don't change the coach PIN or client access codes as part of a "deploy" — those are content changes that need explicit approval.
