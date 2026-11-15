"""SahayakCare backend — FastAPI app.

Free-tier only: SQLite file, no managed database, no paid add-ons.
Run locally:  uvicorn main:app --reload
Run in Docker: uvicorn main:app --host 0.0.0.0 --port $PORT

Local dev needs a JWT secret: set JWT_SECRET_KEY in .env, or export
SAHAYAKCARE_ALLOW_DEV_SECRET=1 (random per-process secret).
"""
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

import auth
import models
import routers_data
from config import get_settings
from database import Base, engine

settings = get_settings()

MAX_REQUEST_BYTES = 1_000_000  # ~1 MB: a whole-state sync is far smaller


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tables are created at startup (not import time), so importing the
    # app never has side effects on the database.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="SahayakCare API",
    lifespan=lifespan,
    # API docs are a live endpoint map: disabled in production, where
    # the app is a demo backend. Local dev keeps them.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_size_limit(request: Request, call_next):
    length = request.headers.get("content-length")
    try:
        size = int(length) if length is not None else 0
    except ValueError:
        size = 0
    if size > MAX_REQUEST_BYTES:
        return JSONResponse(
            status_code=413, content={"detail": "Request body too large"}
        )
    return await call_next(request)


# ------------------------------------------------------------------ auth rate limit
# In-memory, production-only: 5 auth attempts/minute and 10/hour per IP.
# (Local dev and tests run with it off, so the test suite is unaffected.)
_auth_hits: defaultdict[str, list[float]] = defaultdict(list)


@app.middleware("http")
async def auth_rate_limit(request: Request, call_next):
    if settings.rate_limit_enabled and request.url.path.startswith("/api/auth"):
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        stamps = [t for t in _auth_hits[ip] if now - t < 3600]
        if len([t for t in stamps if now - t < 60]) >= 5 or len(stamps) >= 10:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many attempts — please try again later"},
            )
        stamps.append(now)
        _auth_hits[ip] = stamps
    return await call_next(request)


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(routers_data.router, prefix="/api", tags=["data"])


@app.get("/")
def read_root():
    return {"message": "SahayakCare API"}


@app.get("/health")
def health():
    return {"status": "ok"}
