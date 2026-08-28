# ⚠️ DisasterX — AI-Driven Hyper-Local Early Warning System for Severe Weather Nowcasting

> **Smart India Hackathon Prototype**  
> Real-time nowcasting (2 to 6-hour actionable lead time) for **Severe Thunderstorms, Cloudbursts, and Flash Floods** bypassing traditional NWP computational latency using a multi-modal Spatiotemporal Multi-Task Deep Learning architecture.

---

## 🌪️ The Problem
India is vulnerable to rapidly intensifying, localized extreme weather events such as cloudbursts, severe thunderstorms, and flash floods. Traditional physics-based Numerical Weather Prediction (NWP) models suffer from high computational latency and fail to resolve hyper-local convective precursors.

## 🚀 The DisasterX Solution
DisasterX ingests multi-modal satellite, reanalysis, and topographic data onto a unified spatiotemporal grid to deliver **2 to 6-hour lead-time probabilistic risk maps** and automated alerts:

1. **Moisture Fuel**: Captures rapid **Integrated Water Vapor (IWV)** spatial-temporal accumulations from INSAT-3D/3DR Water Vapor channels.
2. **Atmospheric Instability & Energy**: Monitors **CAPE** surge and **CIN** erosion from IMDAA thermodynamic baselines.
3. **Kinematics & Updrafts**: Tracks explosive **Cloud Top Temperature (CTT) Drop Rates** and low-level wind convergence.
4. **Topographic Catalyst**: Fuses atmospheric cloudburst vectors with **Digital Elevation Models (ISRO CartoDEM / SRTM)** for slope and river basin runoff routing to predict flash floods.
5. **Multi-Task Learning (MTL)**: Shared spatiotemporal cross-attention backbone with distinct output heads for simultaneous multi-hazard predictions.
6. **Explainable AI (XAI)**: Quantifies precursor percentage attributions for any point on the map.

---

## 🛠️ Architecture

```
DisasterX/
├── engine/                      # AI Predictive & Precursor Engine
│   ├── data_generator.py        # Multi-modal fusion (INSAT, IMDAA, CartoDEM)
│   ├── model.py                 # Multi-Task Learning (MTL) nowcasting model
│   └── xai.py                   # Explainable AI feature attribution engine
├── backend/                     # High-Performance API Service
│   └── app.py                   # FastAPI REST API & GeoJSON endpoints
├── web/                         # Clean, Minimal Interactive Spatial Dashboard
│   ├── index.html               # Clean dark-mode GIS dashboard
│   ├── style.css                # Minimalist design system
│   └── app.js                   # Interactive map, timeline scrubber & XAI inspector
├── DisasterX_app/               # Android Mobile Application & Mesh Alert Client
├── run.py                       # Single-command runner
└── requirements.txt             # Lightweight Python dependencies
```

---

## ⚡ Quickstart

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Launch Prototype
```bash
python run.py
```
Open **`http://127.0.0.1:8000`** in your browser.

---

## 📡 API Endpoints

- `GET /api/status`: Satellite and telemetry health status
- `GET /api/regions`: Monitored high-vulnerability sectors (Western Himalayas, Western Ghats/Mumbai, Northeast Assam, Kerala)
- `GET /api/nowcast/grid?lead_time=2.0`: GeoJSON risk probability grid for 2h–6h lead times
- `GET /api/nowcast/xai?lat=30.316&lon=78.550&lead_time=2.0`: XAI precursor breakdown and plain-language explanation
- `GET /api/alerts`: Active threshold breach warning alerts
- `POST /api/simulate-scenario`: Inject localized convective burst or flash flood scenarios
