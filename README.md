# SahayakCare — Elderly Care & Medication Management Platform

Built solo for **Catalyst — Solo AI Hackathon** (MnM / Makers Need More × PromptWars × Hack2Skill, 15 Nov 2026).

**Problem statement (official):** *Elderly Care & Medication Management Platform* — a smart, interconnected healthcare platform that helps elderly individuals manage daily medications, medical appointments, and healthcare routines while keeping family members and caretakers informed. The challenge: go beyond a basic reminder app.

## What it does

SahayakCare is a single-page web app for one shared care profile (demo: Shanti Devi, 74). It covers every requirement in the problem statement:

- **Shared care ecosystem** — one healthcare profile for the elderly person, family, and caretakers. Everyone in the Care Circle sees the same medicines, appointments, and adherence.
- **Secure passcode access** — the profile opens only with the family passcode (demo passcode: `1234`, shown on the lock screen).
- **Medication schedules** — view, add, edit, and delete medicines with dose, times of day, purpose, notes, and tablet stock (with a low-stock warning at ≤ 10 tablets).
- **Adherence tracking** — mark each dose Taken / Missed; a 7-day adherence ring, a day streak, and a dose history are computed live from what is marked.
- **Doctor appointments** — upcoming and past appointments with doctor, specialty, date, time, clinic, and notes; the next appointment is highlighted on the dashboard.
- **Proactive reminders** — a reminders engine flags missed doses, doses due soon, and appointments in the next 48 hours. Each reminder can send a pre-filled email to the primary caretaker (opens in the user's own mail app — no backend, no data leaves the device).
- **Vitals log** — blood pressure, blood sugar, weight, and pulse, with latest readings and a full history.
- **Elderly-friendly by design** — large-text mode, English/Hindi toggle, big touch targets, high-contrast status colours.

## Tech

- Single self-contained `index.html` — vanilla JavaScript, Tailwind CSS via CDN. No build step, no backend, no dependencies to install.
- All data persists in the browser's `localStorage` (key `sahayakcare_v1`); a "Reset demo data" button restores the seed data.
- Dates use the device's local timezone.

## Run it

Open `index.html` in any modern browser, or visit the deployed link: https://stalwart-shortbread-198c2f.netlify.app — enter the demo passcode `1234` on the lock screen.

## Honest notes

- Demo data only — all people, medicines, and appointments are fictional. Not medical advice.
- Email reminders are drafted through the user's own mail app (`mailto:` links) because this prototype has no backend; in-app reminder alerts are live and computed from the real schedule.
- The passcode is a demo gate, not real security — it demonstrates the required passcode-based access pattern.

## Files

- `index.html` — the whole app (markup, styles, logic).
- `README.md` — this file.
- `linkedin-post.txt` — the LinkedIn post text submitted with this project.

Built by Aman Kumar — final-year B.Tech CSE (AI & ML), KIET '27.
