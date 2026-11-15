# SahayakCare backend

FastAPI + SQLite backend for SahayakCare. **Free-tier only**: SQLite file,
no managed database, no paid add-ons, no credit card anywhere.

## Run locally

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # then set a real JWT_SECRET_KEY in .env
.venv/bin/uvicorn main:app --reload
```

API docs: http://127.0.0.1:8000/docs — Health: `GET /health`.

## Deploy (Render free tier)

1. Push this repo to GitHub (the `render.yaml` in this folder is the
   Blueprint — in the Render dashboard create a new Blueprint and point
   it at `backend/render.yaml`, or copy it to the repo root).
2. Render creates the `sahayakcare` web service (plan: free) and
   generates a random `JWT_SECRET_KEY` for you.
3. Copy the service URL (live: `https://sahayakcare.onrender.com`)
   into `index.html`: `const API_BASE_URL = "https://sahayakcare.onrender.com";`
   (no trailing slash needed). Redeploy the frontend.

Free-tier notes, stated plainly:
- The SQLite file lives on the service's ephemeral disk — data survives
  restarts but **resets on redeploy, and also when the sleeping backend
  wakes on a fresh instance**. The frontend always keeps a local
  copy in localStorage, so the demo never loses data.
- Free web services **sleep after ~15 minutes of inactivity** and take
  ~30–60s to wake on the next request. The frontend treats a sleeping
  backend as "offline" and keeps working on localStorage, silently.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET_KEY` | dev-only default | **Must be set in production.** Long random string, e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Never commit it. |
| `DATABASE_URL` | `sqlite:///./sahayakcare.db` | Any SQLAlchemy URL. |
| `CORS_ALLOW_ORIGINS` | `*` | Comma-separated origins, or `*` for the demo. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` (7 days) | JWT lifetime. |
| `PORT` | `8000` | Render sets this automatically. |

## API

Auth — `POST /api/auth/register` `{name, email, password}` → 201 user
(no password ever returned) · `POST /api/auth/login` (form-encoded
`username` + `password`, OAuth2 style) → `{access_token, token_type}` ·
`GET /api/auth/me` (Bearer token) → current user. Passwords are bcrypt
hashes; tokens are HS256 JWTs.

All data routes need `Authorization: Bearer <token>` and only ever touch
the logged-in user's own rows. Records are addressed by the frontend's
own string ids (`m1`, `a2`, …), so no id mapping is needed.

| Route | Purpose |
|---|---|
| `GET/POST /api/medicines`, `PUT/DELETE /api/medicines/{id}` | Medicine CRUD |
| `GET/POST /api/appointments`, `PUT/DELETE /api/appointments/{id}` | Appointment CRUD |
| `GET/POST /api/members`, `PUT/DELETE /api/members/{id}` | Care-circle CRUD (`status`: `pending` / `approved`) |
| `GET/POST /api/vitals`, `DELETE /api/vitals/{id}` | Vitals log |
| `GET /api/doses?from=&to=`, `POST /api/doses` | Dose log (upsert by date + medicine + slot) |
| `GET /api/state` | Whole app state; **404** when the user never saved (so the frontend keeps its local data instead of wiping to empty) |
| `PUT /api/state` | Replace the whole app state in one transaction |

The frontend (`index.html`, `API_BASE_URL`) uses `GET/PUT /api/state` for
sync; the granular routes are real, tested, and available for any other
client. The demo passcode is local-only and is never sent to the server.

## Tests

```bash
.venv/bin/python -m pytest tests/ -q   # 31 tests: auth flow, validation, full CRUD, state sync, per-user isolation
```
