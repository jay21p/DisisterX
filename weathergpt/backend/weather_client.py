"""
WeatherGPT - Meteorological Data Client
----------------------------------------
Thin wrapper around free public weather data providers (Open-Meteo network),
which itself blends numerical weather prediction (NWP) models such as
NOAA GFS, DWD ICON and others -- giving WeatherGPT real, live meteorological
data without needing private API keys.

All functions are synchronous + use urllib (no extra network deps) so the
service stays lightweight and easy to run for a hackathon demo.
"""

import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

DEFAULT_HEADERS = {"User-Agent": "WeatherGPT-SIH2026/1.0"}

WMO_CODE_MAP = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}

WMO_ICON_MAP = {
    0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
    45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌧️",
    56: "🌧️", 57: "🌧️",
    61: "🌧️", 63: "🌧️", 65: "🌧️",
    66: "🌧️", 67: "🌧️",
    71: "🌨️", 73: "🌨️", 75: "❄️", 77: "❄️",
    80: "🌦️", 81: "🌧️", 82: "⛈️",
    85: "🌨️", 86: "❄️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
}


def describe_code(code: Optional[int]) -> str:
    if code is None:
        return "Unknown"
    return WMO_CODE_MAP.get(int(code), "Unknown")


def icon_for_code(code: Optional[int]) -> str:
    if code is None:
        return "❔"
    return WMO_ICON_MAP.get(int(code), "🌡️")


def _get_json(url: str, params: Dict[str, Any], timeout: float = 8.0) -> Dict[str, Any]:
    query = urllib.parse.urlencode(params, doseq=True)
    full_url = f"{url}?{query}"
    req = urllib.request.Request(full_url, headers=DEFAULT_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            return json.loads(data.decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error contacting weather provider: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Bad response from weather provider: {exc}") from exc


# Indian states / union territories are administrative regions, not "places"
# in the GeoNames-based geocoder used above, so direct name search often
# fails or resolves to an unrelated same-named village abroad (e.g. "Kerala"
# -> a Finnish hamlet). This lookup (capital / representative coordinates)
# lets WeatherGPT answer state-level questions ("flood alert in Kerala")
# sensibly before falling back to the general geocoder.
INDIA_STATE_COORDS: Dict[str, Dict[str, Any]] = {
    "andhra pradesh": {"lat": 16.5062, "lon": 80.6480, "label": "Amaravati, Andhra Pradesh"},
    "arunachal pradesh": {"lat": 27.0844, "lon": 93.6053, "label": "Itanagar, Arunachal Pradesh"},
    "assam": {"lat": 26.1445, "lon": 91.7362, "label": "Guwahati, Assam"},
    "bihar": {"lat": 25.5941, "lon": 85.1376, "label": "Patna, Bihar"},
    "chhattisgarh": {"lat": 21.2514, "lon": 81.6296, "label": "Raipur, Chhattisgarh"},
    "goa": {"lat": 15.2993, "lon": 74.1240, "label": "Panaji, Goa"},
    "gujarat": {"lat": 23.0225, "lon": 72.5714, "label": "Ahmedabad, Gujarat"},
    "haryana": {"lat": 30.7333, "lon": 76.7794, "label": "Chandigarh, Haryana"},
    "himachal pradesh": {"lat": 31.1048, "lon": 77.1734, "label": "Shimla, Himachal Pradesh"},
    "jharkhand": {"lat": 23.3441, "lon": 85.3096, "label": "Ranchi, Jharkhand"},
    "karnataka": {"lat": 12.9716, "lon": 77.5946, "label": "Bengaluru, Karnataka"},
    "kerala": {"lat": 8.5241, "lon": 76.9366, "label": "Thiruvananthapuram, Kerala"},
    "madhya pradesh": {"lat": 23.2599, "lon": 77.4126, "label": "Bhopal, Madhya Pradesh"},
    "maharashtra": {"lat": 19.0760, "lon": 72.8777, "label": "Mumbai, Maharashtra"},
    "manipur": {"lat": 24.8170, "lon": 93.9368, "label": "Imphal, Manipur"},
    "meghalaya": {"lat": 25.5788, "lon": 91.8933, "label": "Shillong, Meghalaya"},
    "mizoram": {"lat": 23.7271, "lon": 92.7176, "label": "Aizawl, Mizoram"},
    "nagaland": {"lat": 25.6751, "lon": 94.1086, "label": "Kohima, Nagaland"},
    "odisha": {"lat": 20.2961, "lon": 85.8245, "label": "Bhubaneswar, Odisha"},
    "punjab": {"lat": 30.7333, "lon": 76.7794, "label": "Chandigarh, Punjab"},
    "rajasthan": {"lat": 26.9124, "lon": 75.7873, "label": "Jaipur, Rajasthan"},
    "sikkim": {"lat": 27.3389, "lon": 88.6065, "label": "Gangtok, Sikkim"},
    "tamil nadu": {"lat": 13.0827, "lon": 80.2707, "label": "Chennai, Tamil Nadu"},
    "telangana": {"lat": 17.3850, "lon": 78.4867, "label": "Hyderabad, Telangana"},
    "tripura": {"lat": 23.8315, "lon": 91.2868, "label": "Agartala, Tripura"},
    "uttar pradesh": {"lat": 26.8467, "lon": 80.9462, "label": "Lucknow, Uttar Pradesh"},
    "uttarakhand": {"lat": 30.3165, "lon": 78.0322, "label": "Dehradun, Uttarakhand"},
    "west bengal": {"lat": 22.5726, "lon": 88.3639, "label": "Kolkata, West Bengal"},
    "delhi": {"lat": 28.6139, "lon": 77.2090, "label": "New Delhi, Delhi"},
    "jammu and kashmir": {"lat": 34.0837, "lon": 74.7973, "label": "Srinagar, Jammu & Kashmir"},
    "ladakh": {"lat": 34.1526, "lon": 77.5771, "label": "Leh, Ladakh"},
    "puducherry": {"lat": 11.9416, "lon": 79.8083, "label": "Puducherry"},
    "chandigarh": {"lat": 30.7333, "lon": 76.7794, "label": "Chandigarh"},
}


def match_india_state(query: str) -> Optional[Dict[str, Any]]:
    key = query.strip().lower()
    return INDIA_STATE_COORDS.get(key)


# The public geocoder indexes place names in Latin script (GeoNames-based), so
# a Devanagari/regional-script query like "नासिक" or "पुणे" returns zero
# results even though the city exists. This small transliteration lookup for
# common major Indian cities keeps voice/typed queries in Hindi, Marathi,
# Bengali etc. working end-to-end for the demo; anything not listed still
# falls through to the normal geocoder (and to "place not found" gracefully).
INDIAN_CITY_TRANSLITERATIONS: Dict[str, str] = {
    # Hindi
    "नासिक": "Nashik", "मुंबई": "Mumbai", "पुणे": "Pune", "दिल्ली": "Delhi",
    "जयपुर": "Jaipur", "लखनऊ": "Lucknow", "पटना": "Patna", "भोपाल": "Bhopal",
    "कोलकाता": "Kolkata", "चेन्नई": "Chennai", "बेंगलुरु": "Bengaluru",
    "बेंगलूर": "Bengaluru", "हैदराबाद": "Hyderabad", "अहमदाबाद": "Ahmedabad",
    "चंडीगढ़": "Chandigarh", "रांची": "Ranchi", "रायपुर": "Raipur",
    "देहरादून": "Dehradun", "शिमला": "Shimla", "श्रीनगर": "Srinagar",
    "अमृतसर": "Amritsar", "वाराणसी": "Varanasi", "आगरा": "Agra",
    "इंदौर": "Indore", "नागपुर": "Nagpur", "सूरत": "Surat",
    "कानपुर": "Kanpur", "गुवाहाटी": "Guwahati", "कोच्चि": "Kochi",
    "तिरुवनंतपुरम": "Thiruvananthapuram", "विशाखापत्तनम": "Visakhapatnam",
    # Marathi
    "मुंबई शहर": "Mumbai", "पुणे शहर": "Pune", "नागपूर": "Nagpur",
    "नाशिक": "Nashik", "औरंगाबाद": "Aurangabad", "कोल्हापूर": "Kolhapur",
    # Bengali
    "কলকাতা": "Kolkata", "মুম্বাই": "Mumbai", "দিল্লি": "Delhi",
    # Tamil
    "சென்னை": "Chennai", "மும்பை": "Mumbai", "டெல்லி": "Delhi",
    # Telugu
    "హైదరాబాద్": "Hyderabad", "చెన్నై": "Chennai",
    # Kannada
    "ಬೆಂಗಳೂರು": "Bengaluru", "ಮುಂಬೈ": "Mumbai",
    # Gujarati
    "અમદાવાદ": "Ahmedabad", "સુરત": "Surat",
    # Punjabi
    "ਅੰਮ੍ਰਿਤਸਰ": "Amritsar", "ਚੰਡੀਗੜ੍ਹ": "Chandigarh",
    # Urdu
    "دہلی": "Delhi", "ممبئی": "Mumbai",
}


def transliterate_indian_city(query: str) -> Optional[str]:
    return INDIAN_CITY_TRANSLITERATIONS.get(query.strip())


def geocode_place(query: str, count: int = 5, language: str = "en") -> List[Dict[str, Any]]:
    """Resolve a free-text place name (Indian city/village/town/state) to lat/lon."""
    translit = transliterate_indian_city(query)
    if translit:
        query = translit

    state_hit = match_india_state(query)
    if state_hit:
        return [{
            "name": state_hit["label"].split(",")[0],
            "admin1": query.title(),
            "admin2": None,
            "country": "India",
            "country_code": "IN",
            "latitude": state_hit["lat"],
            "longitude": state_hit["lon"],
            "timezone": "Asia/Kolkata",
            "population": None,
        }]

    data = _get_json(GEOCODE_URL, {
        "name": query,
        "count": count,
        "language": language,
        "format": "json",
    })
    results = data.get("results") or []
    out = []
    for r in results:
        out.append({
            "name": r.get("name"),
            "admin1": r.get("admin1"),
            "admin2": r.get("admin2"),
            "country": r.get("country"),
            "country_code": r.get("country_code"),
            "latitude": r.get("latitude"),
            "longitude": r.get("longitude"),
            "timezone": r.get("timezone"),
            "population": r.get("population"),
        })
    # Bias toward India when the same name exists in multiple countries and
    # the query looks like it could plausibly be Indian (heuristic: any
    # Indian match present -> prefer it, since WeatherGPT targets India).
    india_matches = [r for r in out if r.get("country_code") == "IN"]
    if india_matches and out and out[0].get("country_code") != "IN":
        # keep India matches first, but preserve the rest for disambiguation
        rest = [r for r in out if r.get("country_code") != "IN"]
        out = india_matches + rest
    return out


def get_weather_bundle(lat: float, lon: float, days: int = 7,
                        model: str = "best_match") -> Dict[str, Any]:
    """
    Fetch current conditions + hourly (next 24h) + daily (N days) forecast.
    `model` can be 'best_match' (blended ensemble), 'gfs_seamless' (NOAA GFS),
    or 'icon_seamless' (DWD ICON) to demonstrate NWP model integration.
    """
    days = max(1, min(days, 16))
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ",".join([
            "temperature_2m", "relative_humidity_2m", "apparent_temperature",
            "precipitation", "weathercode", "windspeed_10m", "winddirection_10m",
            "is_day", "surface_pressure", "cloudcover",
        ]),
        "hourly": ",".join([
            "temperature_2m", "precipitation_probability", "precipitation",
            "weathercode", "windspeed_10m", "relative_humidity_2m",
        ]),
        "daily": ",".join([
            "weathercode", "temperature_2m_max", "temperature_2m_min",
            "precipitation_sum", "precipitation_probability_max",
            "windspeed_10m_max", "windgusts_10m_max", "uv_index_max",
            "sunrise", "sunset",
        ]),
        "timezone": "auto",
        "forecast_days": days,
    }
    if model and model != "best_match":
        params["models"] = model

    data = _get_json(FORECAST_URL, params)

    current = data.get("current", {}) or {}
    current_code = current.get("weathercode")

    daily_raw = data.get("daily", {}) or {}
    daily_time = daily_raw.get("time", [])
    daily = []
    for i, day in enumerate(daily_time):
        daily.append({
            "date": day,
            "weathercode": daily_raw.get("weathercode", [None] * len(daily_time))[i],
            "description": describe_code(daily_raw.get("weathercode", [None] * len(daily_time))[i]),
            "icon": icon_for_code(daily_raw.get("weathercode", [None] * len(daily_time))[i]),
            "temp_max": daily_raw.get("temperature_2m_max", [None] * len(daily_time))[i],
            "temp_min": daily_raw.get("temperature_2m_min", [None] * len(daily_time))[i],
            "precip_sum_mm": daily_raw.get("precipitation_sum", [None] * len(daily_time))[i],
            "precip_prob_max": daily_raw.get("precipitation_probability_max", [None] * len(daily_time))[i],
            "wind_max_kmh": daily_raw.get("windspeed_10m_max", [None] * len(daily_time))[i],
            "wind_gust_max_kmh": daily_raw.get("windgusts_10m_max", [None] * len(daily_time))[i],
            "uv_index_max": daily_raw.get("uv_index_max", [None] * len(daily_time))[i],
            "sunrise": daily_raw.get("sunrise", [None] * len(daily_time))[i],
            "sunset": daily_raw.get("sunset", [None] * len(daily_time))[i],
        })

    hourly_raw = data.get("hourly", {}) or {}
    hourly_time = hourly_raw.get("time", [])
    now_iso = current.get("time")
    # find index of "now" (or closest future) to slice next 24h
    start_idx = 0
    if now_iso and hourly_time:
        for i, t in enumerate(hourly_time):
            if t >= now_iso:
                start_idx = i
                break
    hourly = []
    for i in range(start_idx, min(start_idx + 24, len(hourly_time))):
        hourly.append({
            "time": hourly_time[i],
            "temp": hourly_raw.get("temperature_2m", [None] * len(hourly_time))[i],
            "precip_prob": hourly_raw.get("precipitation_probability", [None] * len(hourly_time))[i],
            "precip_mm": hourly_raw.get("precipitation", [None] * len(hourly_time))[i],
            "weathercode": hourly_raw.get("weathercode", [None] * len(hourly_time))[i],
            "icon": icon_for_code(hourly_raw.get("weathercode", [None] * len(hourly_time))[i]),
            "wind_kmh": hourly_raw.get("windspeed_10m", [None] * len(hourly_time))[i],
            "humidity": hourly_raw.get("relative_humidity_2m", [None] * len(hourly_time))[i],
        })

    return {
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "timezone": data.get("timezone"),
        "elevation": data.get("elevation"),
        "model_used": model,
        "current": {
            "time": current.get("time"),
            "temperature": current.get("temperature_2m"),
            "feels_like": current.get("apparent_temperature"),
            "humidity": current.get("relative_humidity_2m"),
            "precipitation_mm": current.get("precipitation"),
            "weathercode": current_code,
            "description": describe_code(current_code),
            "icon": icon_for_code(current_code),
            "wind_kmh": current.get("windspeed_10m"),
            "wind_dir_deg": current.get("winddirection_10m"),
            "is_day": bool(current.get("is_day")),
            "pressure_hpa": current.get("surface_pressure"),
            "cloudcover_pct": current.get("cloudcover"),
        },
        "hourly_next_24h": hourly,
        "daily": daily,
    }


def get_air_quality(lat: float, lon: float) -> Dict[str, Any]:
    try:
        data = _get_json(AIR_QUALITY_URL, {
            "latitude": lat,
            "longitude": lon,
            "current": "pm2_5,pm10,us_aqi,european_aqi,carbon_monoxide,ozone,nitrogen_dioxide",
        })
        cur = data.get("current", {}) or {}
        return {
            "pm2_5": cur.get("pm2_5"),
            "pm10": cur.get("pm10"),
            "us_aqi": cur.get("us_aqi"),
            "european_aqi": cur.get("european_aqi"),
            "ozone": cur.get("ozone"),
            "nitrogen_dioxide": cur.get("nitrogen_dioxide"),
        }
    except Exception:
        return {}


def get_historical_climate(lat: float, lon: float, start_date: str, end_date: str) -> Dict[str, Any]:
    """Historical daily climate data for trend / research analysis."""
    data = _get_json(ARCHIVE_URL, {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max",
        "timezone": "auto",
    })
    return data.get("daily", {}) or {}


def build_alerts(weather: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Rule-based Early Warning engine.
    Scans the forecast bundle for thresholds commonly used by IMD-style
    advisories and returns structured, severity-tagged alerts.
    """
    alerts: List[Dict[str, Any]] = []
    current = weather.get("current", {})
    daily = weather.get("daily", [])

    # --- Current condition alerts ---
    if current.get("weathercode") in (95, 96, 99):
        alerts.append({
            "type": "Thunderstorm",
            "severity": "high",
            "message": "Active thunderstorm reported right now. Avoid open fields, water bodies and tall trees.",
        })
    wind_now = current.get("wind_kmh") or 0
    if wind_now >= 50:
        alerts.append({
            "type": "High Wind",
            "severity": "high",
            "message": f"Strong winds of {wind_now} km/h detected. Secure loose objects; avoid coastal/marine activity.",
        })

    # --- Forecast (next few days) alerts ---
    for d in daily[:5]:
        date = d.get("date")
        if (d.get("precip_prob_max") or 0) >= 70 and (d.get("precip_sum_mm") or 0) >= 40:
            alerts.append({
                "type": "Heavy Rainfall",
                "severity": "high",
                "date": date,
                "message": f"Heavy rainfall expected on {date} ({d.get('precip_sum_mm')} mm, "
                            f"{d.get('precip_prob_max')}% chance). Flood/waterlogging risk in low-lying areas.",
            })
        elif (d.get("precip_prob_max") or 0) >= 60:
            alerts.append({
                "type": "Rain Advisory",
                "severity": "moderate",
                "date": date,
                "message": f"Moderate to high chance of rain ({d.get('precip_prob_max')}%) on {date}.",
            })

        if (d.get("temp_max") or 0) >= 42:
            alerts.append({
                "type": "Heatwave",
                "severity": "high",
                "date": date,
                "message": f"Extreme heat expected on {date}: {d.get('temp_max')}°C. Avoid outdoor exertion 11am-4pm.",
            })
        if (d.get("temp_min") is not None) and d.get("temp_min") <= 4:
            alerts.append({
                "type": "Cold Wave",
                "severity": "moderate",
                "date": date,
                "message": f"Cold wave conditions expected on {date}: min {d.get('temp_min')}°C.",
            })

        if (d.get("wind_gust_max_kmh") or 0) >= 60:
            alerts.append({
                "type": "Damaging Wind Gusts",
                "severity": "high",
                "date": date,
                "message": f"Gusts up to {d.get('wind_gust_max_kmh')} km/h expected on {date}. "
                            f"Risk to weak structures, standing crops and fishing boats.",
            })

        if d.get("weathercode") in (95, 96, 99):
            alerts.append({
                "type": "Thunderstorm Outlook",
                "severity": "moderate",
                "date": date,
                "message": f"Thunderstorm activity likely on {date}.",
            })

        if (d.get("uv_index_max") or 0) >= 8:
            alerts.append({
                "type": "High UV",
                "severity": "low",
                "date": date,
                "message": f"Very high UV index ({d.get('uv_index_max')}) on {date}. Use sun protection.",
            })

    if not alerts:
        alerts.append({
            "type": "No Significant Alerts",
            "severity": "low",
            "message": "No extreme weather thresholds breached for the current forecast window.",
        })
    return alerts


def build_advisory(weather: Dict[str, Any], persona: str) -> str:
    """Generate a short rule-based fallback advisory line per use-case persona."""
    daily = weather.get("daily", [{}])
    today = daily[0] if daily else {}
    rain = today.get("precip_prob_max") or 0
    wind = today.get("wind_max_kmh") or 0
    temp_max = today.get("temp_max")

    persona = (persona or "general").lower()
    if persona == "farmer":
        if rain >= 60:
            return "High rain chance today — delay pesticide/fertilizer spraying and irrigation; ensure field drainage."
        if temp_max and temp_max >= 38:
            return "Hot conditions — irrigate during early morning/evening and monitor crops for heat stress."
        return "Conditions look normal for routine field operations today."
    if persona == "aviation":
        if wind >= 40:
            return "Elevated surface winds — expect crosswind/turbulence advisories; verify METAR/TAF before ops."
        if today.get("weathercode") in (95, 96, 99):
            return "Thunderstorm risk in the area — expect convective SIGMETs and possible ground delays."
        return "No major ceiling/visibility/wind hazards from this outlook; confirm with official METAR/TAF."
    if persona == "marine":
        if wind >= 40:
            return "Rough sea conditions likely — small craft/fishing advisory suggested; avoid venturing offshore."
        return "Sea conditions appear moderate; standard precautions advised."
    if persona == "urban":
        if rain >= 60:
            return "Urban waterlogging risk — city drainage/traffic teams should prepare pumps and diversions."
        return "No major urban-infrastructure weather risk detected today."
    return "Stay updated with official IMD bulletins for your area."
