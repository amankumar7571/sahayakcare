"""Backend tests: auth flow + one full CRUD flow + state sync + isolation."""
import pytest


# ------------------------------------------------------------------ auth
def test_register_returns_user_without_password(client):
    r = client.post(
        "/api/auth/register",
        json={"name": "Meera", "email": "meera@example.com", "password": "pass1234"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "meera@example.com"
    assert "password" not in body
    assert "password_hash" not in body


def test_register_duplicate_email_rejected(client, registered_user):
    r = client.post(
        "/api/auth/register",
        json={"name": "Again", "email": "test@example.com", "password": "secret123"},
    )
    assert r.status_code == 400


def test_login_wrong_password_rejected(client, registered_user):
    r = client.post(
        "/api/auth/login",
        data={"username": "test@example.com", "password": "wrong-password"},
    )
    assert r.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_token(client, registered_user):
    _, headers = registered_user
    r = client.get("/api/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["email"] == "test@example.com"


def test_protected_endpoints_require_token(client):
    assert client.get("/api/medicines").status_code == 401
    assert client.get("/api/state").status_code == 401


# ------------------------------------------------------------------ medicines CRUD
def test_medicine_crud_flow(client, registered_user):
    _, h = registered_user
    med = {
        "id": "m1", "name": "Metformin", "dose": "500 mg",
        "times": ["morning", "night"], "purpose": "Diabetes",
        "stock": 18, "notes": "Take with food", "createdAt": "2026-11-09",
    }
    r = client.post("/api/medicines", json=med, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Metformin"

    r = client.get("/api/medicines", headers=h)
    assert [m["id"] for m in r.json()] == ["m1"]

    med["stock"] = 17
    r = client.put("/api/medicines/m1", json=med, headers=h)
    assert r.status_code == 200 and r.json()["stock"] == 17

    r = client.delete("/api/medicines/m1", headers=h)
    assert r.status_code == 204
    assert client.get("/api/medicines", headers=h).json() == []


def test_duplicate_medicine_id_rejected(client, registered_user):
    _, h = registered_user
    med = {"id": "m1", "name": "A", "dose": "1 mg", "times": ["morning"]}
    assert client.post("/api/medicines", json=med, headers=h).status_code == 201
    assert client.post("/api/medicines", json=med, headers=h).status_code == 400


def test_update_missing_medicine_404(client, registered_user):
    _, h = registered_user
    med = {"id": "nope", "name": "A", "dose": "1 mg", "times": []}
    assert client.put("/api/medicines/nope", json=med, headers=h).status_code == 404


# ------------------------------------------------------------------ other resources
def test_appointment_member_vital_crud(client, registered_user):
    _, h = registered_user

    appt = {"id": "a1", "doctor": "Dr. X", "specialty": "Cardiology",
            "date": "2026-11-20", "time": "10:30", "place": "Clinic", "notes": ""}
    assert client.post("/api/appointments", json=appt, headers=h).status_code == 201
    assert len(client.get("/api/appointments", headers=h).json()) == 1
    assert client.delete("/api/appointments/a1", headers=h).status_code == 204
    assert client.get("/api/appointments", headers=h).json() == []

    member = {"id": "c1", "name": "Meera", "role": "Primary caretaker",
              "phone": "+91 98110 12345", "email": "meera@example.com",
              "status": "pending"}
    assert client.post("/api/members", json=member, headers=h).status_code == 201
    member["status"] = "approved"
    r = client.put("/api/members/c1", json=member, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "approved"

    vital = {"id": "v1", "type": "Blood Pressure", "value": "128/82",
             "date": "2026-11-13", "note": "Morning"}
    assert client.post("/api/vitals", json=vital, headers=h).status_code == 201
    assert len(client.get("/api/vitals", headers=h).json()) == 1


# ------------------------------------------------------------------ dose log
def test_dose_log_upsert_and_list(client, registered_user):
    _, h = registered_user
    dose = {"date": "2026-11-15", "medicine_id": "m1",
            "slot": "morning", "status": "taken"}
    r = client.post("/api/doses", json=dose, headers=h)
    assert r.status_code == 201 and r.json()["status"] == "taken"

    # Same key again overwrites (mark taken -> missed).
    dose["status"] = "missed"
    r = client.post("/api/doses", json=dose, headers=h)
    assert r.status_code == 201 and r.json()["status"] == "missed"

    r = client.get("/api/doses?from=2026-11-15&to=2026-11-15", headers=h)
    assert len(r.json()) == 1
    assert r.json()[0]["status"] == "missed"


# ------------------------------------------------------------------ state sync
def test_state_empty_before_first_save(client, registered_user):
    _, h = registered_user
    assert client.get("/api/state", headers=h).status_code == 404


def test_state_round_trip(client, registered_user):
    _, h = registered_user
    payload = {
        "medicines": [{"id": "m1", "name": "Metformin", "dose": "500 mg",
                       "times": ["morning"], "purpose": "Diabetes", "stock": 18,
                       "notes": "", "createdAt": "2026-11-09"}],
        "appointments": [{"id": "a1", "doctor": "Dr. X", "specialty": "",
                          "date": "2026-11-20", "time": "10:00", "place": "",
                          "notes": ""}],
        "circle": [{"id": "c1", "name": "Meera", "role": "Primary caretaker",
                    "phone": "", "email": "meera@example.com", "status": "approved"}],
        "vitals": [{"id": "v1", "type": "Weight", "value": "68",
                    "date": "2026-11-09", "note": ""}],
        "doseLog": {"2026-11-15|m1|morning": "taken"},
    }
    r = client.put("/api/state", json=payload, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["medicines"][0]["name"] == "Metformin"
    assert body["doseLog"] == {"2026-11-15|m1|morning": "taken"}

    # The granular endpoints see the same data.
    assert len(client.get("/api/medicines", headers=h).json()) == 1
    assert len(client.get("/api/doses", headers=h).json()) == 1

    # A second PUT replaces, not appends.
    payload["medicines"] = []
    r = client.put("/api/state", json=payload, headers=h)
    assert r.json()["medicines"] == []
    assert client.get("/api/medicines", headers=h).json() == []


def test_state_empty_put_returns_200_and_get_returns_empty_state(client, registered_user):
    _, h = registered_user
    # Never saved: GET is 404 so the frontend keeps its local data.
    assert client.get("/api/state", headers=h).status_code == 404

    # An explicit empty PUT is a successful write, not a 404.
    empty = {"medicines": [], "appointments": [], "circle": [],
             "vitals": [], "doseLog": {}}
    r = client.put("/api/state", json=empty, headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == empty

    # After that save, GET returns the (empty) saved state, not 404.
    r = client.get("/api/state", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == empty


# ------------------------------------------------------------------ isolation
def test_users_cannot_see_each_others_data(client, registered_user):
    _, h1 = registered_user
    med = {"id": "m1", "name": "Metformin", "dose": "500 mg", "times": ["morning"]}
    assert client.post("/api/medicines", json=med, headers=h1).status_code == 201

    client.post("/api/auth/register",
                json={"name": "Other", "email": "other@example.com", "password": "secret123"})
    login = client.post("/api/auth/login",
                        data={"username": "other@example.com", "password": "secret123"})
    h2 = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # Other user sees nothing and cannot touch user 1's record.
    assert client.get("/api/medicines", headers=h2).json() == []
    assert client.put("/api/medicines/m1", json=med, headers=h2).status_code == 404
    assert client.delete("/api/medicines/m1", headers=h2).status_code == 404
    assert client.get("/api/medicines", headers=h1).json() != []


def test_health_and_root(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/").status_code == 200
