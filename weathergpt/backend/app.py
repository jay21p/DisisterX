"""
WeatherGPT — Conversational AI for Weather Forecasting, Alerts & Climate Info
SIH 2026 Prototype Backend (FastAPI)

Endpoints:
  GET  /api/health                      -> service status
  GET  /api/geocode?q=Nashik             -> place search
  GET  /api/weather?lat=..&lon=..        -> full forecast bundle
  GET  /api/alerts?lat=..&lon=..         -> extreme weather alerts
  GET  /api/air-quality?lat=..&lon=..    -> AQI
  GET  /api/climate?lat=&lon=&start=&end=-> historical climate series
  GET  /api/advisory?lat=&lon=&persona=  -> decision-support advisory
  POST /api/chat                         -> conversational WeatherGPT (LLM + tools)
  GET  /api/languages                    -> supported languages for UI + voice
  Static site served at /                -> web/ (chat UI + dashboard)
"""

import os
import time
import traceback
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from . import weather_client as wc
from . import llm_engine
from . import fallback_engine

APP_START = time.time()

app = FastAPI(
    title="WeatherGPT API",
    description="Conversational AI for Weather Forecasting, Alerts and Climate Information — SIH 2026",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    language: str = "en"


class ChatResponse(BaseModel):
    reply: str
    language: str
    tool_trace: List[Dict[str, Any]] = []


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "WeatherGPT",
        "uptime_seconds": round(time.time() - APP_START, 1),
    }


@app.get("/api/languages")
def languages():
    return {"languages": [{"code": k, "label": v} for k, v in llm_engine.LANGUAGE_NAMES.items()]}


# ---------------------------------------------------------------------------
# Data endpoints (used directly by dashboard widgets, also usable by LLM)
# ---------------------------------------------------------------------------

@app.get("/api/geocode")
def geocode(q: str = Query(..., min_length=1)):
    try:
        return {"results": wc.geocode_place(q)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/weather")
def weather(lat: float = Query(...), lon: float = Query(...),
            days: int = Query(7, ge=1, le=16),
            model: str = Query("best_match")):
    try:
        return wc.get_weather_bundle(lat, lon, days=days, model=model)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/alerts")
def alerts(lat: float = Query(...), lon: float = Query(...)):
    try:
        bundle = wc.get_weather_bundle(lat, lon, days=7)
        return {"location": {"latitude": bundle["latitude"], "longitude": bundle["longitude"]},
                "alerts": wc.build_alerts(bundle)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/air-quality")
def air_quality(lat: float = Query(...), lon: float = Query(...)):
    try:
        return wc.get_air_quality(lat, lon)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/climate")
def climate(lat: float = Query(...), lon: float = Query(...),
            start: str = Query(..., description="YYYY-MM-DD"),
            end: str = Query(..., description="YYYY-MM-DD")):
    try:
        return wc.get_historical_climate(lat, lon, start, end)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/advisory")
def advisory(lat: float = Query(...), lon: float = Query(...),
             persona: str = Query("general")):
    try:
        bundle = wc.get_weather_bundle(lat, lon, days=3)
        return {"persona": persona, "advisory": wc.build_advisory(bundle, persona)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ---------------------------------------------------------------------------
# Conversational engine
# ---------------------------------------------------------------------------

@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    try:
        result = llm_engine.chat(messages, language=req.language)
        if result.get("reply"):
            return result
        raise RuntimeError("empty reply from LLM engine")
    except Exception as exc:
        # Graceful degradation: fall back to the rule-based NLU engine so the
        # chatbot keeps working even without a valid LLM API key / network.
        print(f"[WeatherGPT] LLM engine unavailable, using fallback engine: {exc}")
        try:
            reply = fallback_engine.generate_reply(messages, language=req.language)
            return {"reply": reply, "language": req.language, "tool_trace": [{"engine": "fallback_rule_based"}]}
        except Exception as exc2:
            traceback.print_exc()
            raise HTTPException(status_code=502, detail=f"WeatherGPT engine error: {exc2}")


# ---------------------------------------------------------------------------
# Static frontend (serve the web/ folder as the SPA, at the root path)
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(os.path.join(WEB_DIR, "index.html"))


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
