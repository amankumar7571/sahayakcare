"""Round-8 backend tests: validation (422s), auth edges, isolation on
state/doses, partial PUT semantics, JSON-body login, CORS headers,
and the fail-closed JWT-secret config."""
import os
import subprocess
import sys
from datetime import timedelta

import pytest

import auth


# ------------------------------------------------------------------ validation (422s)
def test_weak_password_rejected(client):
    r = client.post(
        "/api/auth/register",
        json={"name": "Weak", "email": "weak@example.com", "password": "1"},
    )
    assert r.status_code == 422, r.text


def test_malformed_email_rejected(client):
    r = client.post(
        "/api/auth/register",
        json={"name": "Bad", "email": "not-an-email", "password": "secret123"},
    )
    assert r.status_code == 422, r.text


def test_invalid_dose_slot_rejected(client, registered_user):
    _, h = registered_user
    med = {"id": "m1", "name": "A", "dose": "1 mg", "times": ["midnight"]}
    assert client.post("/api/medicines", json=med, headers=h).status_code == 422


def test_negative_stock_rejected(client, registered_user):
    _, h = registered_user
    med = {"id": "m1", "name": "A", "dose": "1 mg", "times": ["morning"], "stock": -5}
    assert client.post("/api/medicines", json=med, headers=h).status_code == 422


def test_empty_times_rejected_on_create(client, registered_user):
    _, h = registered_user
    med = {"id": "m1", "name": "A", "dose": "1 mg", "times": []}
    assert client.post("/api/medicines", json=med, headers=h).status_code == 422


def test_malformed_dose_key_in_put_state_rejected(client, registered_user):
    _, h = registered_user
    payload = {"medicines": [], "appointments": [], "circle": [],
               "vitals": [], "doseLog": {"not-a-key": "taken"}}
    assert client.put("/api/state", json=payload, headers=h).status_code == 422


def test_null_stock_means_not_tracked(client, registered_user):
    _, h = registered_user
    med = {"id": "m1", "name": "A", "dose": "1 mg", "times": ["morning"], "stock": None}
    r = client.post("/api/medicines", json=med, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["stock"] is None


# ------------------------------------------------------------------ auth edges
def test_expired_token_rejected(client, registered_user):
    _, h = registered_user
    expired = auth.create_access_token(
        data={"sub": "test@example.com"}, expires_delta=timedelta(minutes=-1)
    )
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401


def test_malformed_token_rejected(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage.token.here"})
    assert r.status_code == 401
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_login_with_json_body_rejected(client, registered_user):
    # Login is an OAuth2 form flow: a JSON body must fail (the frontend
    # posts application/x-www-form-urlencoded with username/password).
    r = client.post(
        "/api/auth/login",
        json={"username": "test@example.com", "password": "secret123"},
    )
    assert r.status_code == 422, r.text


def test_register_duplicate_is_generic(client, registered_user):
    # No "Email already registered" enumeration: the same generic
    # message either way.
    r = client.post(
        "/api/auth/register",
        json={"name": "Again", "email": "test@example.com", "password": "secret123"},
    )
    assert r.status_code == 400
    assert "already registered" not in r.json()["detail"].lower()


# ------------------------------------------------------------------ isolation: state + doses
def test_state_and_doses_isolated_between_users(client, registered_user):
    _, h1 = registered_user
    payload = {
        "medicines": [{"id": "m1", "name": "Metformin", "dose": "500 mg",
                       "times": ["morning"], "purpose": "", "stock": 18,
                       "notes": "", "createdAt": "2026-11-09"}],
        "appointments": [], "circle": [], "vitals": [],
        "doseLog": {"2026-11-15|m1|morning": "taken"},
    }
    assert client.put("/api/state", json=payload, headers=h1).status_code == 200

    client.post("/api/auth/register",
                json={"name": "Other", "email": "other@example.com", "password": "secret123"})
    login = client.post("/api/auth/login",
                        data={"username": "other@example.com", "password": "secret123"})
    h2 = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # Other user has no saved state at all (404, not user 1's data).
    assert client.get("/api/state", headers=h2).status_code == 404
    assert client.get("/api/doses", headers=h2).json() == []
    # And cannot upsert a dose into user 1's log under the same key.
    r = client.post("/api/doses", json={"date": "2026-11-15", "medicine_id": "m1",
                                        "slot": "morning", "status": "missed"}, headers=h2)
    assert r.status_code == 201
    assert client.get("/api/doses", headers=h1).json()[0]["status"] == "taken"


# ------------------------------------------------------------------ partial PUT semantics
def test_partial_put_defaults_missing_collections_to_empty(client, registered_user):
    _, h = registered_user
    full = {
        "medicines": [{"id": "m1", "name": "Metformin", "dose": "500 mg",
                       "times": ["morning"], "purpose": "", "stock": 18,
                       "notes": "", "createdAt": "2026-11-09"}],
        "appointments": [{"id": "a1", "doctor": "Dr. X", "specialty": "",
                          "date": "2026-11-20", "time": "10:00", "place": "",
                          "notes": ""}],
        "circle": [], "vitals": [],
        "doseLog": {"2026-11-15|m1|morning": "taken"},
    }
    assert client.put("/api/state", json=full, headers=h).status_code == 200
    # A PUT that omits appointments/doseLog replaces the whole state:
    # missing collections default to [] (documented semantics — the
    # frontend always sends the complete state).
    partial = {"medicines": full["medicines"]}
    r = client.put("/api/state", json=partial, headers=h)
    assert r.status_code == 200, r.text
    body = client.get("/api/state", headers=h).json()
    assert body["medicines"][0]["id"] == "m1"
    assert body["appointments"] == []
    assert body["doseLog"] == {}


# ------------------------------------------------------------------ CORS headers
def test_cors_preflight_allows_configured_origin(client):
    r = client.options(
        "/api/state",
        headers={
            "Origin": "https://stalwart-shortbread-198c2f.netlify.app",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") in (
        "https://stalwart-shortbread-198c2f.netlify.app",
        "*",
    )


# ------------------------------------------------------------------ fail-closed JWT secret
def test_settings_raise_without_secret_or_opt_in():
    # Run in a subprocess so the test process keeps its (working) settings.
    env = {k: v for k, v in os.environ.items()
           if k not in ("JWT_SECRET_KEY", "SAHAYAKCARE_ALLOW_DEV_SECRET")}
    env["PYTHONPATH"] = os.path.join(os.path.dirname(__file__), "..")
    code = "from config import Settings; Settings()"
    proc = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True, text=True,
        cwd=os.path.join(os.path.dirname(__file__), ".."),
    )
    assert proc.returncode != 0, proc.stdout + proc.stderr
    assert "JWT_SECRET_KEY" in proc.stderr
