# PeaBe Coaching Hub — Phoebe's End-to-End Testing Checklist

> Last refreshed: 2026-05-09 · Build v11430+
>
> Tick through this in order the first time. After that, dip in to spot-check whatever you've changed.

The hub does a lot. This walks you through every real workflow at least once so you catch anything broken before a client does.

---

## 0. Setup checks (5 min)

These are quick environment confirmations before you test features.

- [ ] Open https://hub.phoebeblamey.com.au — page loads, you see the landing screen
- [ ] Type the secret reveal phrase, enter the coach PIN `Happy_529` (case-sensitive — note the capital H + underscore), the coach hub opens
- [ ] Top-right pill shows the current build (e.g. `v11430`) — that's your version
- [ ] Settings → scroll to the integrations cluster
  - [ ] Gmail — green "Live" pill
  - [ ] Zoom — green "Live" pill
  - [ ] Calendly — green "Live" pill
  - [ ] Anthropic — green "Live" pill
  - [ ] Stripe — yellow/amber until you set the keys (expected for now)
  - [ ] WhatsApp — yellow/amber until Meta Business is set up (expected)
  - [ ] Twilio — yellow/amber (optional)
- [ ] Settings → "📅 Calendar (Google / Apple / Outlook)" card explains the .ics approach (no green pill needed — that's deliberate)

If any required pill is red, re-check the env vars in Netlify → Site settings → Environment variables.

---

## 1. Coach login + landing (3 min)

- [ ] Sign out, sign back in — PIN works, hub opens to "All clients"
- [ ] Sidebar: 💛 Happy Hub · 👥 All clients · 💡 MDC Cohort · ✅ Task Sheet · 📊 Revenue · 🛠 Settings — every link works
- [ ] Switch theme (🌙/☀️ in topbar) — colours flip cleanly, refresh keeps the choice
- [ ] Press <kbd>Esc</kbd> from anywhere — closes any open modal, search overlay, or onboarding flow

---

## 2. Add a brand-new client manually (5 min)

- [ ] Settings → "+ Add client" (or sidebar `+` button)
- [ ] Enter: name, email, pick a program (try `90-Day Business Builder` first), session date
- [ ] Save — new client appears in the All-clients grid
- [ ] Click the card → client detail opens
- [ ] **Summary tab** loads with the hero card (avatar, name, business, status, "+ Add my why" button)
- [ ] **Top of Summary tab → 📋 sub-nav** — Jump-to chips work: Intake answers · Client snapshot · AI research brief · Past briefs · Coaching notes · Profitability
- [ ] Click `+ Add my why` → field opens, type a why, save → it appears in the hero band
- [ ] Click `✦ Suggest one` instead → AI drafts something (or, if no profile data, you get a Phoebe-voice starter — never the dead-end "not enough data" message)

---

## 3. Universal intake + per-program overlays (5 min)

- [ ] Open the client → click the **Summary** tab (was "Intake")
- [ ] You see the universal intake — 5 default questions
- [ ] Type an answer → field saves on blur (status pill briefly says "Saving…" then "Saved")
- [ ] Edit the wording of a built-in question → next reload shows your edited version
- [ ] Add a new custom question → it appears with a `custom` pill
- [ ] Tap `✦ Auto-fill blanks` → AI drafts answers for empty fields (or tells you it can't if there's nothing to work from)
- [ ] **Per-program overlay**: add an MDC program to the same client (Settings → "+ Add another program") → return to Summary → 3 new MDC-specific questions appear with a teal `MDC` pill on each
- [ ] Same for any program you switch to

### Customise the defaults

- [ ] Settings → 🎯 Default intake questions
- [ ] Edit one of the universal questions → flush dot indicator confirms save
- [ ] Open the MDC overlay → add a new question
- [ ] Click `📤 Sync to existing clients` → confirms then toasts "Synced — N questions added across N clients"
- [ ] Click `↺ Reset to built-ins` → confirms, restores the originals

---

## 4. AI research brief flow (10 min)

This is the heaviest AI feature. Worth a careful pass.

- [ ] Client detail → **Summary** tab → scroll to "🔬 Research brief"
- [ ] Click `✦ AI generate` → the textarea fills with a "Running deep dive…" message, then 30-90 seconds later a full markdown brief appears
- [ ] The "⚠️ For Phoebe's attention" panel renders **above** the brief in orange (or green if all-clear)
- [ ] If the panel has questions/concerns: scroll to the bottom of the panel — there's a "💬 Reply to Claude's questions" textarea
- [ ] Type a reply (e.g. "I already know about the legal issue, ignore that — but flag the burnout signs") → click `↻ Regenerate brief with my reply`
- [ ] Brief regenerates in 30-60s with your input folded in; old concern is gone, new one is highlighted
- [ ] `📋 Copy` copies the brief to the clipboard
- [ ] `⛶ Expand` opens a full-screen editor; close it (X or Esc) and your edits are saved back

---

## 5. Tasks — per client + Task Sheet (10 min)

### Per-client tasks tab

- [ ] In the client detail → click the **Tasks** tab (now shows the green Shareable pill)
- [ ] Add a task → it appears in the open list
- [ ] Tap `📦` next to a task → task is archived (gone from view)
- [ ] Header now shows "1 archived · 📦 Show archived" → click → archived task reappears with a restore button
- [ ] Tap `×` (red) on a task → confirm dialog, type to delete forever
- [ ] Cancel the confirm → task is intact

### Cross-client Task Sheet

- [ ] Sidebar → ✅ Task Sheet
- [ ] Top filter pills work: All open · Coach only · Client visible · Overdue · Completed
- [ ] Add a task via the global "+ Add task" form → picks a client, saves, appears under their group
- [ ] Click `☐ Bulk select` (top right) → mode flips on; rows get checkboxes
- [ ] Tick 2-3 tasks → floating action bar appears at the bottom: ✓ Mark done · 📅 Bulk due-date · 👁 Make client-visible · 🔒 Make coach-only · 📦 Archive · × Delete
- [ ] Try "✓ Mark done" → confirms, all selected tasks tick off
- [ ] Bulk select again → "📦 Archive" → archived tasks drop off the Task Sheet
- [ ] `× Cancel` exits bulk mode

---

## 6. Message templates (5 min)

- [ ] Open any client → **Message client** tab
- [ ] Templates row at the top: dropdown picker · 💾 Save as template · 📋 Manage
- [ ] Type a subject + body using `{firstName}` and `{clientName}` placeholders
- [ ] Click `💾 Save as template` → name it "Welcome message"
- [ ] Refresh the page → reopen the same client → the template is still there
- [ ] Pick "Welcome message" from the dropdown → fields auto-fill, placeholders swap to that client's name
- [ ] Click `📋 Manage` → list of templates with delete buttons
- [ ] Open a different client → Message tab → use the same template → placeholders use this client's name (proves it's not stuck on the original client)

---

## 7. Custom sections + section templates (5 min)

- [ ] Open a client → **Session notes** tab → scroll to "📌 Custom sections"
- [ ] `+ Add a section` → blank section with title + body fields
- [ ] Type a useful title + body (e.g. "Sprint kick-off · Top 3 priorities for the next 2 weeks · …")
- [ ] Click the `🔓 Shared with client` toggle → flips to coach-only and back
- [ ] Click the new `💾 Template` chip on the meta row → save it as "Sprint kick-off"
- [ ] Open a different client → same tab → click `📋 From template…`
- [ ] Picker shows your saved template with title + body preview → click it → section copies in
- [ ] In the picker, click the `×` next to a template → confirm delete

---

## 8. Onboarding flow (3 min)

- [ ] Sign out of coach
- [ ] Visit `/?client=<test-code>` (e.g. `?client=ELOD99`) — client portal opens
- [ ] If onboarding hasn't been completed for this client, the welcome modal appears
- [ ] Walk through the 5 steps: Welcome → Set your why → Mood → Plan → How to ask Phoebe anything
- [ ] On step 2 (Why), tap `✦ Suggest one for me` → either an AI draft appears, or a Phoebe-style starter shows in the textarea (no dead-end message)
- [ ] `× Skip` button works at every step, modal closes
- [ ] Press <kbd>Esc</kbd> mid-flow → onboarding closes (same as Skip)
- [ ] Reload — onboarding doesn't reappear (because it's marked complete)

---

## 9. Calendly → Zoom → AI summary loop (15 min)

This is the magic flow. Test once you have a real or test booking ready.

- [ ] In Calendly, book a session into one of Phoebe's event types (use a test email like elodie+test@…)
- [ ] Within ~30 seconds, go to All clients → the new booking appears as a fresh client
- [ ] Open them → research brief auto-runs in the background (you'll see a status pill on the Summary tab)
- [ ] Run the Zoom session (or a test Zoom call you record to the cloud)
- [ ] When recording finishes processing, the Zoom webhook fires → check the bell icon top-right for a "New transcript ready" notification
- [ ] Open the client → **Session notes** tab → newest note has the AI summary attached
- [ ] Review the summary, tweak if needed, tick `Share with client` → it appears in the client portal

---

## 10. Bulk client actions (5 min)

- [ ] All-clients page → click `☐ Bulk select` (top right)
- [ ] Tick 2-3 client cards → floating bar appears: 📧 Email all · 🔔 Mark all seen · 🌱 Set status · 💡 Add to cohort · 🎖 Award badge · 🔒 Archive
- [ ] Try `🌱 Set status` → type "nurture" → confirms → all selected clients flip to nurture status
- [ ] Cancel the bulk mode

---

## 11. Cohort manager + MDC (10 min)

- [ ] Sidebar → 💡 MDC Cohort
- [ ] Current cohort card opens with members, sessions, Zoom link, dates
- [ ] Click `+ Add session` → fill in date/time → cohort Zoom link reused
- [ ] Open any cohort member → their MDC Sprint tab shows current sprint number, week-of-sprint, top-3 priorities
- [ ] Cohort feed: post a shoutout, log a milestone — both surface on every member's portal

---

## 12. Mobile pass (5 min)

- [ ] Open the hub on your phone
- [ ] Topbar collapses correctly (logo · build pill · settings · sign out)
- [ ] Sidebar becomes a bottom-tab bar on the client portal
- [ ] Open a client on mobile → Summary tab → scroll feels natural
- [ ] Tap any modal → corner X is reachable with a thumb
- [ ] Press the system back button → returns to the previous tab/view (history is wired)

---

## 13. Things you should NEVER see

If any of these show up, write them down with a screenshot and ping Elodie:

- Native browser `alert()` / `confirm()` / `prompt()` boxes (everything should use the branded modal)
- The text "Conflicting update" or any merge-conflict prompt (v11400 killed it — should never reappear)
- Empty pink fields with "undefined" / "null" / "[object Object]"
- AI responses that say "as an AI language model" or break into corporate-speak
- US English spellings ("organize", "color", "favor")
- A modal you can't close

---

## When something is wrong

1. Note the version (the `v11xxx` pill in the topbar)
2. Note what you clicked, what you expected, what actually happened
3. Open browser dev tools → Console tab → screenshot any red errors
4. Send all that to Elodie — she can usually fix in under 30 minutes from a clear bug report
