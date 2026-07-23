import os

from dotenv import load_dotenv
load_dotenv()  # unlike Next.js, plain uvicorn does not auto-load .env — must be explicit

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics

app = FastAPI(title="Argus — Italiano Vero sales ops")

app.add_middleware(
    CORSMiddleware,
    # wildcard + credentials is invalid per browser spec — must be an exact origin
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_google.router)
app.include_router(auth_google.me_router)
app.include_router(units.router)
app.include_router(leads.router)
app.include_router(spravka.router)
app.include_router(assistant.router)
app.include_router(pricing.router)
app.include_router(analytics.router)


@app.get("/health")
def health():
    return {"status": "ok"}
