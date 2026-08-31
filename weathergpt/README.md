# 🌤️ WeatherGPT — Conversational AI for Weather Forecasting, Alerts & Climate Information

> **Smart India Hackathon 2026 Prototype**
> A chatbot platform that answers weather, forecast, alert and climate
> questions in natural language (multiple Indian languages + voice), backed
> by live meteorological data, and available on **both a website and an
> Android app that loads the same website** — so there is only one UI to
> maintain and the app is always in sync with the site.

---

## 🧩 How the app connects to the website

```
┌─────────────────────┐        HTTPS         ┌───────────────────────────┐
│  WeatherGPT_app/     │  loads in a WebView   │  web/ (chat + dashboard)  │
│  (Android APK)       │ ───────────────────▶  │  served by FastAPI at /  │
└─────────────────────┘                        │                           │
                                                │  backend/app.py           │
        Same REST calls                        │   /api/weather             │
        (fetch, same-origin)  ─────────────────▶│   /api/alerts              │
                                                │   /api/chat  (LLM engine)  │
                                                │   /api/advisory, /aqi, …   │
                                                └───────────────────────────┘
```

* The Android app (`WeatherGPT_app/`) is a thin **WebView wrapper**
  (`MainActivity.java`) that simply opens the deployed WeatherGPT website URL
  configured in `app/src/main/res/values/strings.xml` → `weathergpt_url`.
* Because the website itself calls the backend via same-origin `fetch()`
  requests (see `web/app.js`), the exact same chat, dashboard, alerts, voice
  input and language switching that work in a desktop browser work
  identically inside the Android app — no separate mobile codebase, no data
  duplication, always up to date.
* To point the app at a different deployment, change **one string** in
  `strings.xml` and rebuild — no other code changes needed.
* GPS ("📍 Use my location") and the microphone (🎤 voice input, via the
  browser's Web Speech API) are bridged through `WebChromeClient` so they
  work natively inside the wrapped WebView, with runtime permission requests
  already wired up in `MainActivity`.

---

## 🏗️ Project Structure

```
weathergpt/
├── backend/                  # FastAPI service
│   ├── app.py                 # REST endpoints + serves web/ as the SPA
│   ├── weather_client.py      # Open-Meteo (GFS/ICON NWP blend) data layer,
│   │                           #   geocoding, alerts engine, advisories
│   ├── llm_engine.py           # LLM function-calling conversational engine
│   └── fallback_engine.py      # Rule-based NLU fallback (works with no LLM key)
├── web/                       # The actual product UI (chat + dashboard)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── WeatherGPT_app/             # Android app (Gradle project)
│   └── app/src/main/java/com/sih/weathergpt/MainActivity.java
├── run.py                      # `python run.py` starts everything on :8010
└── requirements.txt
```

---

## ⚡ Quickstart (Website + Backend)

```bash
cd weathergpt
pip install -r requirements.txt
python run.py
```

Open **http://127.0.0.1:8010** — you get the full chat + dashboard site.
Swagger API docs: **http://127.0.0.1:8010/docs**

### LLM configuration

The conversational engine (`backend/llm_engine.py`) uses an OpenAI-compatible
endpoint (env vars `OPENAI_API_KEY` / `OPENAI_BASE_URL`, or
`~/.genspark_llm.yaml`). If no valid key is configured, `backend/app.py`
**automatically falls back** to `fallback_engine.py`, a rule-based NLU engine
that still answers real questions using live data (English + Hindi + Marathi
demo support) — so the demo never breaks in an offline/no-key judging room.

---

## 📡 Key API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/geocode?q=Nashik` | Resolve any Indian place/state name to coordinates |
| `GET /api/weather?lat=&lon=&days=7&model=gfs_seamless\|icon_seamless\|best_match` | Current + hourly + daily forecast, selectable NWP model source (demonstrates GFS/ICON integration) |
| `GET /api/alerts?lat=&lon=` | Rule-based extreme-weather early-warning alerts (rain, heatwave, cold wave, thunderstorm, wind, UV) |
| `GET /api/air-quality?lat=&lon=` | PM2.5 / PM10 / AQI |
| `GET /api/climate?lat=&lon=&start=&end=` | Historical daily climate series for trend analysis |
| `GET /api/advisory?lat=&lon=&persona=farmer\|aviation\|marine\|urban` | Decision-support advisory text |
| `POST /api/chat` | `{messages:[{role,content}], language}` → conversational WeatherGPT reply |
| `GET /api/languages` | Supported UI/voice languages |

---

## 🗣️ Features implemented against the SIH problem statement

- ✅ Real-time weather retrieval (Open-Meteo, blended GFS/ICON NWP models)
- ✅ Natural-language querying (LLM function-calling + rule-based fallback NLU)
- ✅ NWP model selection (`best_match` / `gfs_seamless` / `icon_seamless`)
- ✅ Extreme weather alerts & early warnings (heavy rain, heatwave, cold wave,
     thunderstorm, damaging wind gusts, high UV)
- ✅ Location-based forecasting & persona advisories (farmer / aviation /
     marine / urban)
- ✅ Multilingual UI + chat (13 Indian languages selectable; Hindi/Marathi
     demoed end-to-end in the offline fallback engine)
- ✅ Climate trend / historical analysis (Open-Meteo archive API)
- ✅ Voice-enabled interaction (Web Speech API mic button, works in both the
     website and inside the Android WebView)
- ✅ Mobile app that mirrors the website 1:1 (Android WebView client)

---

## 📱 Building the Android APK

The project ships as a standard Gradle Android project
(`WeatherGPT_app/`) using the Gradle wrapper already vendored in this repo.
This sandbox environment does not have the Android SDK installed, so the APK
itself was **not compiled here** — build it locally or in CI with Android
Studio / the Android SDK:

```bash
cd weathergpt/WeatherGPT_app
# 1. Edit app/src/main/res/values/strings.xml -> weathergpt_url
#    to point at your deployed WeatherGPT backend (https://... )
./gradlew assembleDebug
# APK output: app/build/outputs/apk/debug/app-debug.apk
```

Requirements: Android Studio (or Android SDK cmdline-tools) + JDK 17,
`compileSdk 34`, `minSdk 24`.

> ⚠️ Not an official IMD alert system — WeatherGPT is a hackathon prototype
> using public open weather data; always cross-check life-critical decisions
> against official India Meteorological Department bulletins.
