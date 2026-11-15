"""SahayakCare backend — FastAPI app.

Free-tier only: SQLite file, no managed database, no paid add-ons.
Run locally:  uvicorn main:app --reload
Run in Docker: uvicorn main:app --host 0.0.0.0 --port $PORT
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import auth
import models
import routers_data
from config import get_settings
from database import Base, engine

settings = get_settings()

if settings.using_dev_secret:
    logging.warning(
        "JWT_SECRET_KEY is the built-in dev default — set a real one "
        "in production (JWT_SECRET_KEY env var)."
    )

Base.metadata.create_all(bind=engine)

app = FastAPI(title="SahayakCare API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(routers_data.router, prefix="/api", tags=["data"])


@app.get("/")
def read_root():
    return {"message": "SahayakCare API — see /docs for the API"}


@app.get("/health")
def health():
    return {"status": "ok"}
