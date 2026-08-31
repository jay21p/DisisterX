"""
WeatherGPT Prototype Launcher
Starts the FastAPI backend + serves the chat/dashboard website.
"""

import sys
import uvicorn

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

if __name__ == "__main__":
    print("=" * 65)
    print(">> Starting WeatherGPT: Conversational AI for Weather & Climate")
    print("=" * 65)
    print("-> Data sources: Open-Meteo (GFS / ICON NWP blend), Air Quality, Archive")
    print("-> LLM Engine: OpenAI-compatible function-calling agent")
    print("-> Dashboard + Chat URL: http://127.0.0.1:8010")
    print("-> Swagger API Docs: http://127.0.0.1:8010/docs")
    print("=" * 65)

    uvicorn.run("backend.app:app", host="0.0.0.0", port=8010, reload=False)
