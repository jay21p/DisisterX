"""
WeatherGPT - Conversational Query Understanding Engine
--------------------------------------------------------
Wraps an OpenAI-compatible LLM with function-calling ("tools") so the model
can decide, in natural language conversation, when it needs to fetch live
weather data, geocode a place name, pull alerts, or look up climate history --
then compose a grounded, cited, multilingual answer.

This is the "AI/LLM-based query understanding engine" required by the
SIH problem statement, implemented against the sandbox's OpenAI-compatible
proxy (see get_external_api_docs tool docs).
"""

import os
import json
import yaml
from pathlib import Path
from typing import List, Dict, Any, Optional

from openai import OpenAI

from . import weather_client as wc

# ---------------------------------------------------------------------------
# Client bootstrap: read ~/.genspark_llm.yaml if present, else env vars.
# ---------------------------------------------------------------------------


def _load_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("OPENAI_BASE_URL")
    cfg_path = Path.home() / ".genspark_llm.yaml"
    if cfg_path.exists():
        try:
            cfg = yaml.safe_load(cfg_path.read_text()) or {}
            oa = cfg.get("openai", {}) or {}
            api_key = api_key or oa.get("api_key")
            base_url = base_url or oa.get("base_url")
        except Exception:
            pass
    if api_key and api_key.startswith("${") and api_key.endswith("}"):
        env_name = api_key[2:-1]
        api_key = os.environ.get(env_name, api_key)
    return OpenAI(api_key=api_key, base_url=base_url)


_client: Optional[OpenAI] = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = _load_client()
    return _client


MODEL_NAME = os.environ.get("WEATHERGPT_MODEL", "gpt-5-mini")

LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi (हिन्दी)",
    "mr": "Marathi (मराठी)",
    "bn": "Bengali (বাংলা)",
    "ta": "Tamil (தமிழ்)",
    "te": "Telugu (తెలుగు)",
    "kn": "Kannada (ಕನ್ನಡ)",
    "gu": "Gujarati (ગુજરાતી)",
    "pa": "Punjabi (ਪੰਜਾਬੀ)",
    "ml": "Malayalam (മലയാളം)",
    "or": "Odia (ଓଡ଼ିଆ)",
    "as": "Assamese (অসমীয়া)",
    "ur": "Urdu (اردو)",
}

SYSTEM_PROMPT_TEMPLATE = """You are WeatherGPT, a friendly, accurate conversational weather-intelligence
assistant built for India, developed for the Smart India Hackathon (SIH 2026)
problem statement "WeatherGPT: Conversational AI for Weather Forecasting,
Alerts, and Climate Information".

Your job:
- Answer questions about current weather, forecasts, extreme-weather alerts,
  climate trends and location-based advisories in natural language.
- ALWAYS use the provided tools to fetch real, live data before answering
  any question about actual weather/forecast/alerts/climate numbers. Never
  invent numbers yourself.
- If the user gives a place name, call geocode_place first to resolve
  coordinates, then call the relevant weather tool.
- If no place is given and none was established earlier in the conversation,
  politely ask which city/village/district in India (or elsewhere) they mean.
- Tailor advisories to context clues in the question (farmer/crop, pilot/
  aviation, fisherman/marine, city/urban planning, disaster management) using
  the `persona` argument on get_advisory when relevant.
- Keep answers concise, practical, and use simple language a common citizen
  can understand. Use short bullet points for multi-day forecasts.
- Where relevant, mention lead time / validity and remind users to also
  check official IMD bulletins for life-critical decisions.
- Always include relevant weather emoji/icons returned by tools if helpful.

Language: Respond ONLY in {language_name}. Translate all content, including
units labels, into that language, but you may keep place names and numbers
as-is. If the user writes in a different language than {language_name}, still
answer in {language_name} unless they explicitly ask you to switch.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "geocode_place",
            "description": "Resolve a free-text place name (city, town, village, district, "
                            "state) anywhere in the world (optimised for India) to latitude/"
                            "longitude coordinates and admin metadata.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Place name, e.g. 'Nashik' or 'Kota, Rajasthan'"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather_forecast",
            "description": "Get current conditions, next-24h hourly forecast and multi-day "
                            "daily forecast for a location, optionally choosing the "
                            "underlying NWP model (GFS = NOAA Global Forecast System, "
                            "ICON = DWD ICON, or best_match = automatic blend).",
            "parameters": {
                "type": "object",
                "properties": {
                    "latitude": {"type": "number"},
                    "longitude": {"type": "number"},
                    "days": {"type": "integer", "description": "Forecast horizon in days (1-16)", "default": 7},
                    "model": {
                        "type": "string",
                        "enum": ["best_match", "gfs_seamless", "icon_seamless"],
                        "default": "best_match",
                        "description": "NWP model source: best_match (blended), gfs_seamless (NOAA GFS), icon_seamless (DWD ICON, WRF-class regional model)",
                    },
                },
                "required": ["latitude", "longitude"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_extreme_weather_alerts",
            "description": "Compute rule-based extreme weather / early-warning alerts "
                            "(heavy rain, heatwave, cold wave, thunderstorm, high wind, "
                            "high UV) for a location for the next few days.",
            "parameters": {
                "type": "object",
                "properties": {
                    "latitude": {"type": "number"},
                    "longitude": {"type": "number"},
                },
                "required": ["latitude", "longitude"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_air_quality",
            "description": "Get current air quality (PM2.5, PM10, AQI) for a location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "latitude": {"type": "number"},
                    "longitude": {"type": "number"},
                },
                "required": ["latitude", "longitude"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_historical_climate",
            "description": "Get historical daily climate records (temperature, "
                            "precipitation, wind) between two dates for trend/"
                            "research analysis. Dates in YYYY-MM-DD format, "
                            "range should usually be <= 5 years.",
            "parameters": {
                "type": "object",
                "properties": {
                    "latitude": {"type": "number"},
                    "longitude": {"type": "number"},
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                },
                "required": ["latitude", "longitude", "start_date", "end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_advisory",
            "description": "Get a short rule-based decision-support advisory line "
                            "tailored to a use-case persona.",
            "parameters": {
                "type": "object",
                "properties": {
                    "latitude": {"type": "number"},
                    "longitude": {"type": "number"},
                    "persona": {
                        "type": "string",
                        "enum": ["farmer", "aviation", "marine", "urban", "general"],
                    },
                },
                "required": ["latitude", "longitude", "persona"],
            },
        },
    },
]


def _run_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        if name == "geocode_place":
            return {"results": wc.geocode_place(args["query"])}
        if name == "get_weather_forecast":
            return wc.get_weather_bundle(
                args["latitude"], args["longitude"],
                days=int(args.get("days", 7)),
                model=args.get("model", "best_match"),
            )
        if name == "get_extreme_weather_alerts":
            bundle = wc.get_weather_bundle(args["latitude"], args["longitude"], days=7)
            return {"alerts": wc.build_alerts(bundle)}
        if name == "get_air_quality":
            return wc.get_air_quality(args["latitude"], args["longitude"])
        if name == "get_historical_climate":
            return wc.get_historical_climate(
                args["latitude"], args["longitude"],
                args["start_date"], args["end_date"],
            )
        if name == "get_advisory":
            bundle = wc.get_weather_bundle(args["latitude"], args["longitude"], days=3)
            return {"advisory": wc.build_advisory(bundle, args.get("persona", "general"))}
        return {"error": f"Unknown tool {name}"}
    except Exception as exc:  # keep the loop alive; surface error to the LLM
        return {"error": str(exc)}


def chat(messages: List[Dict[str, str]], language: str = "en",
         max_tool_hops: int = 4) -> Dict[str, Any]:
    """
    messages: list of {role: 'user'|'assistant', content: str} -- prior turns.
    Returns: {reply: str, tool_trace: [...], language: str}
    """
    client = get_client()
    lang_name = LANGUAGE_NAMES.get(language, "English")
    system_msg = {"role": "system", "content": SYSTEM_PROMPT_TEMPLATE.format(language_name=lang_name)}

    convo: List[Dict[str, Any]] = [system_msg] + messages
    tool_trace: List[Dict[str, Any]] = []

    for _hop in range(max_tool_hops):
        resp = client.chat.completions.create(
            model=MODEL_NAME,
            messages=convo,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = resp.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None)

        if not tool_calls:
            return {
                "reply": msg.content or "",
                "tool_trace": tool_trace,
                "language": language,
            }

        # Append assistant turn (with tool calls) then each tool result
        convo.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                } for tc in tool_calls
            ],
        })
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _run_tool(tc.function.name, args)
            tool_trace.append({"tool": tc.function.name, "args": args, "result": result})
            convo.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result, default=str),
            })

    # Fallback: force a final answer without further tool calls
    resp = client.chat.completions.create(model=MODEL_NAME, messages=convo)
    return {
        "reply": resp.choices[0].message.content or "",
        "tool_trace": tool_trace,
        "language": language,
    }
