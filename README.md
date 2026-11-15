# SahayakCare — Elderly Care & Medication Management Platform

Elderly care in India runs on memory and missed calls. A grandmother forgets her BP tablet, nobody knows until the next hospital visit — and by then it's a crisis, not a reminder.

SahayakCare is the shared care profile that stops that from happening. One profile for Shanti Devi, 74 — her medicines, her appointments, her vitals — visible to her daughter Meera the moment a dose is missed. When Shanti misses her morning tablet, Meera gets an email draft in one tap. Everyone sees the same truth.

Built solo for **Catalyst — Solo AI Hackathon** (MnM / Makers Need More × PromptWars × Hack2Skill, 15 Nov 2026).

**Built for the 74-year-old, not the 24-year-old developer.** Large-text mode, English/Hindi toggle, big touch targets, high-contrast status colours — the accessibility is the point, not a bullet.

## Try it in 60 seconds

Live demo: https://stalwart-shortbread-198c2f.netlify.app

1. Unlock with the demo passcode `1234` (shown on the lock screen).
2. On the dashboard, mark a morning dose **Taken** — watch the adherence ring and streak move.
3. Open **Reminders** — missed and due-soon doses, upcoming appointments, low stock.
4. Tap **Send email reminder** — a pre-filled email to the primary caretaker opens in your mail app.
5. Open **Care Circle** — add a family member; they join as *Pending approval* until Shanti approves them.
6. Tap **Share care profile** in the footer — it copies a link that opens this exact profile on another device.

## How it maps to the problem statement

| Requirement | Status | How |
|---|---|---|
| Shared ecosystem (elderly + caretakers + family) | ✅ | One care profile + Care Circle; a share link opens the same profile on another device |
| Secure passcode-based access | ✅ | Lock screen gates the whole app; passcode can be changed after unlocking |
| View / add / edit / manage medication schedules | ✅ | Full medicine CRUD: dose, 4 time slots, purpose, stock, notes |
| Adherence tracking | ✅ | Taken/Missed per dose, 7-day adherence ring + %, day streak, most-missed-slot insight |
| Appointment monitoring | ✅ | Full appointment CRUD, next appointment on the dashboard, past ones marked Done |
| Proactive email reminders | ⚠️ Partial | The engine flags missed doses, due-soon doses and appointments in the next 48h and drafts the email to the caretaker in one tap — it opens in your mail app; there is no backend that sends mail by itself |
| Goes beyond a basic reminder app | ✅ | Adherence analytics, vitals log, care circle with approvals, stock warnings, streaks, Hindi + large text |
| Elderly person at the centre | ✅ | The profile is hers (Shanti Devi = owner); new care-circle members need her approval |

## Tech

Single self-contained `index.html` — vanilla JavaScript + Tailwind CSS, no build step, no backend, no account. Data lives in the browser's `localStorage` (key `sahayakcare_v1`); a share link carries the profile in the URL hash. Nothing leaves the device except the email you choose to send.

Built by prompting Gemini, then hand-verified — every feature was traced in the code and tested in the browser (see `test.js`).

## Tests

`node test.js` — 117 checks: JS syntax, every `id` the script references exists in the HTML, every CSS class/variable the rendered views use is defined, no table rows outside a table, mailto links are encoded, every `data-i18n` key exists in both languages. Run it before every deploy.

## Honest notes

- Demo data only — all people, medicines, and appointments are fictional. Not medical advice.
- Email reminders are drafted through your own mail app (`mailto:` links) because this prototype has no backend; the reminders themselves are computed live from the real schedule.
- The passcode is a demo gate, not real security — it demonstrates the required passcode-based access pattern.

## Files

- `index.html` — the whole app (markup, styles, logic).
- `test.js` — smoke tests (run with `node test.js`).
- `README.md` — this file.
- `linkedin-post.txt` — the LinkedIn post text submitted with this project.

Built by Aman Kumar — final-year B.Tech CSE (AI & ML), KIET '27.
