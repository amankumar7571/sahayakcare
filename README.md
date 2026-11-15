# SahayakCare — Elderly Care & Medication Management Platform

Elderly care in India runs on memory and missed calls. A grandmother forgets her BP tablet, nobody knows until the next hospital visit — and by then it's a crisis, not a reminder.

SahayakCare is a care profile for an elderly person that the whole family shares. The family creates the profile, sets a passcode, adds medicines, appointments and vitals — and when a dose is missed, the primary caretaker gets an email draft in one tap. Everyone sees the same truth.

Built solo for **Catalyst — Solo AI Hackathon** (MnM / Makers Need More × PromptWars × Hack2Skill, 15 Nov 2026).

**Built for the 74-year-old, not the 24-year-old developer.** Large-text mode, English/Hindi toggle, big touch targets, high-contrast status colours — the accessibility is the point, not a bullet.

## Try it in 60 seconds

Live: https://stalwart-shortbread-198c2f.netlify.app

1. **Create your care profile** — enter the elderly person's name, set a 4-digit passcode, and you are in with an empty profile. Or tap **Explore a sample profile** to try a pre-filled one (passcode `1234`).
2. Add a medicine — watch the dashboard, adherence ring and streak move.
3. Open **Reminders** — missed and due-soon doses, upcoming appointments, low stock.
4. Tap **Send email reminder** — a pre-filled email to the primary caretaker opens in your mail app.
5. Open **Care Circle** — add a family member; they join as *Pending approval* until the profile owner approves them.
6. Tap **Share care profile** in the footer — it copies a link that opens this exact profile on another device.
7. Tap **Sign in / Create account** on the lock screen (or ☁️ Cloud sync in the header) to save the profile to the cloud and open it on any device.

## How it maps to the problem statement

| Requirement | Status | How |
|---|---|---|
| Shared ecosystem (elderly + caretakers + family) | ✅ | One care profile + Care Circle; a share link opens the same profile on another device |
| Secure passcode-based access | ✅ | Lock screen gates the whole app; the passcode is set when the profile is created and can be changed after unlocking |
| View / add / edit / manage medication schedules | ✅ | Full medicine CRUD: dose, 4 time slots, purpose, stock, notes |
| Adherence tracking | ✅ | Taken/Missed per dose, 7-day adherence ring + %, day streak, most-missed-slot insight |
| Appointment monitoring | ✅ | Full appointment CRUD, next appointment on the dashboard, past ones marked Done |
| Proactive email reminders | ⚠️ Partial | The engine flags missed doses, due-soon doses and appointments in the next 48h and drafts the email to the caretaker in one tap — it opens in your mail app; there is no backend that sends mail by itself |
| Goes beyond a basic reminder app | ✅ | Adherence analytics, vitals log, care circle with approvals, stock warnings, streaks, Hindi + large text |
| Elderly person at the centre | ✅ | The profile belongs to the person it is created for; new care-circle members need the owner's approval |

## Accounts & the passcode

- **Cloud account (the real auth):** sign up / sign in with email + password from the lock screen or the ☁️ Cloud sync button. Passwords are bcrypt-hashed, sessions are JWTs, and every user only sees their own data. The backend is FastAPI + SQLite on Render's free tier, live at https://sahayakcare.onrender.com.
- **Passcode (per profile):** the profile is protected by a 4-digit passcode chosen when the profile is created; it can be changed after unlocking. It never leaves the device and is never sent to the server.
- **First run:** a new visitor creates a profile (name + passcode) and starts empty — no pre-filled people or medicines.
- **Sample profile:** "Explore a sample profile" loads clearly-labelled fictional data (Shanti Devi, passcode 1234) to try the app. It is local-only and never touches a real account.

## Tech

Single self-contained `index.html` — vanilla JavaScript + Tailwind CSS, no build step. New profiles start empty; data lives in the browser's `localStorage` (key `sahayakcare_v1`); a share link carries the profile in the URL hash. Nothing leaves the device except the email you choose to send and, when signed in, the profile data synced to the backend.

**Cloud backend** (`backend/` — FastAPI + SQLite + JWT auth, free Render tier): the app is wired to the live backend at https://sahayakcare.onrender.com (`API_BASE_URL` near the top of the script in `index.html`). Sign in and the profile syncs to the cloud; if the backend is unreachable, the app keeps working on localStorage. See `backend/README.md` for the API, env vars, and deploy steps.

Built by prompting Gemini, then hand-verified — every feature was traced in the code and tested in the browser (see `test.js`).

## Tests

`node test.js` — 170 checks: JS syntax, every `id` the script references exists in the HTML, every CSS class/variable the rendered views use is defined, no table rows outside a table, mailto links are encoded, every `data-i18n` key exists in both languages, plus the real-app checks (no hardcoded passcode, no seeded data on boot, no demo labels, setup screen + lock-screen sign-in + sample link present). Run it before every deploy.

## Honest notes

- A new profile starts empty — no pre-filled people or medicines. The sample profile is fictional data for trying the app, clearly labelled inside the app.
- Email reminders are drafted through your own mail app (`mailto:` links) because there is no mail-sending backend; the reminders themselves are computed live from the real schedule. The cloud backend stores data only — it never sends email.
- The passcode protects the profile on this device; the cloud account (email + password, bcrypt-hashed, JWT) is the authentication layer for sync. The passcode itself never leaves the device.
- On Render's free tier the SQLite file resets on redeploy and the service sleeps after ~15 idle minutes — the frontend treats a sleeping backend as offline and keeps working on localStorage, so the app never breaks.

## Files

- `index.html` — the whole app (markup, styles, logic).
- `backend/` — FastAPI + SQLite + JWT backend (see `backend/README.md`).
- `test.js` — smoke tests (run with `node test.js`).
- `README.md` — this file.
- `linkedin-post.txt` — the LinkedIn post text submitted with this project.

Built by Aman Kumar — final-year B.Tech CSE (AI & ML), KIET '27.
