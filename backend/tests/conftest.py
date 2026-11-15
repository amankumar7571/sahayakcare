"""pytest fixtures: fresh in-memory SQLite DB per test, TestClient."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from database import Base, get_db
from main import app

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _override_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_db


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def registered_user(client):
    """A registered + logged-in user; returns (user_json, auth_headers)."""
    resp = client.post(
        "/api/auth/register",
        json={"name": "Test User", "email": "test@example.com", "password": "secret123"},
    )
    assert resp.status_code == 201, resp.text
    login = client.post(
        "/api/auth/login",
        data={"username": "test@example.com", "password": "secret123"},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    return resp.json(), {"Authorization": f"Bearer {token}"}
