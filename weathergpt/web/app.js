/* ==========================================================================
   WeatherGPT — Frontend logic
   Talks to the FastAPI backend (same origin) for weather data + LLM chat.
   ========================================================================== */

const API = ""; // same-origin; backend serves this static site too

const state = {
  lat: 19.0760,
  lon: 72.8777,
  placeLabel: "Mumbai, Maharashtra",
  language: localStorage.getItem("wg_lang") || "en",
  chatHistory: [], // {role, content}
  persona: "farmer",
};

// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function fmtDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function fmtHour(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
}

function aqiColor(aqi) {
  if (aqi == null) return "#999";
  if (aqi <= 50) return "#2fb170";
  if (aqi <= 100) return "#ffa631";
  if (aqi <= 150) return "#ff7a3d";
  if (aqi <= 200) return "#ff4d4f";
  return "#8b1e3f";
}

// ---------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------
async function loadLanguages() {
  try {
    const data = await getJSON(`${API}/api/languages`);
    const sel = $("#langSelect");
    sel.innerHTML = "";
    data.languages.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.label;
      if (l.code === state.language) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn("language load failed", e);
  }
}

// ---------------------------------------------------------------------
// Location search / geocode
// ---------------------------------------------------------------------
async function searchLocation() {
  const q = $("#locInput").value.trim();
  if (!q) return;
  const box = $("#locSuggestions");
  box.innerHTML = `<div class="suggestion-item">Searching…</div>`;
  try {
    const data = await getJSON(`${API}/api/geocode?q=${encodeURIComponent(q)}`);
    box.innerHTML = "";
    if (!data.results || data.results.length === 0) {
      box.innerHTML = `<div class="suggestion-item">No results found</div>`;
      return;
    }
    data.results.forEach(r => {
      const div = document.createElement("div");
      div.className = "suggestion-item";
      const parts = [r.name, r.admin1, r.country].filter(Boolean);
      div.textContent = `📍 ${parts.join(", ")}`;
      div.onclick = () => {
        state.lat = r.latitude;
        state.lon = r.longitude;
        state.placeLabel = parts.join(", ");
        box.innerHTML = "";
        $("#locInput").value = "";
        refreshDashboard();
      };
      box.appendChild(div);
    });
  } catch (e) {
    box.innerHTML = `<div class="suggestion-item">Search failed — try again</div>`;
  }
}

function useGps() {
  if (!navigator.geolocation) {
    alert("Geolocation not supported on this device/browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    state.lat = pos.coords.latitude;
    state.lon = pos.coords.longitude;
    state.placeLabel = "My Location";
    refreshDashboard();
  }, err => {
    alert("Could not get location: " + err.message);
  });
}

// ---------------------------------------------------------------------
// Dashboard rendering
// ---------------------------------------------------------------------
async function refreshDashboard() {
  $("#placeName").textContent = state.placeLabel;
  $("#placeSub").textContent = `${state.lat.toFixed(2)}, ${state.lon.toFixed(2)}`;

  try {
    const weather = await getJSON(`${API}/api/weather?lat=${state.lat}&lon=${state.lon}&days=7`);
    renderCurrent(weather.current);
    renderDaily(weather.daily);
    renderHourly(weather.hourly_next_24h);
  } catch (e) {
    console.error(e);
  }

  refreshAlerts();
  refreshAdvisory();
  refreshAqi();
}

function renderCurrent(cur) {
  $("#currentIcon").textContent = cur.icon || "🌡️";
  $("#currentTemp").textContent = `${Math.round(cur.temperature)}°C`;
  $("#currentDesc").textContent = `${cur.description} · Feels like ${Math.round(cur.feels_like)}°C`;
  $("#currentGrid").innerHTML = `
    <div class="mini-stat">💧<b>${cur.humidity ?? "--"}%</b>Humidity</div>
    <div class="mini-stat">🌬️<b>${cur.wind_kmh ?? "--"} km/h</b>Wind</div>
    <div class="mini-stat">☔<b>${cur.precipitation_mm ?? 0} mm</b>Rain</div>
  `;
}

function renderDaily(days) {
  const box = $("#dailyForecast");
  box.innerHTML = "";
  days.forEach(d => {
    const div = document.createElement("div");
    div.className = "day-item";
    div.innerHTML = `
      <div class="dname">${fmtDay(d.date)}</div>
      <div class="dicon">${d.icon}</div>
      <div class="dtemp">${Math.round(d.temp_max)}° / ${Math.round(d.temp_min)}°</div>
      <div class="drain">💧 ${d.precip_prob_max ?? 0}%</div>
    `;
    box.appendChild(div);
  });
}

function renderHourly(hours) {
  const box = $("#hourlyForecast");
  box.innerHTML = "";
  hours.forEach(h => {
    const div = document.createElement("div");
    div.className = "hour-item";
    div.innerHTML = `
      <div>${fmtHour(h.time)}</div>
      <div class="hicon">${h.icon}</div>
      <div>${Math.round(h.temp)}°</div>
      <div>💧${h.precip_prob ?? 0}%</div>
    `;
    box.appendChild(div);
  });
}

async function refreshAlerts() {
  const box = $("#alertsList");
  box.innerHTML = `<div class="alert-item">Loading alerts…</div>`;
  try {
    const data = await getJSON(`${API}/api/alerts?lat=${state.lat}&lon=${state.lon}`);
    box.innerHTML = "";
    data.alerts.forEach(a => {
      const div = document.createElement("div");
      div.className = `alert-item ${a.severity}`;
      div.innerHTML = `<span class="a-type">${iconForAlert(a.type)} ${a.type}${a.date ? " · " + a.date : ""}</span>${a.message}`;
      box.appendChild(div);
    });
  } catch (e) {
    box.innerHTML = `<div class="alert-item">Could not load alerts</div>`;
  }
}

function iconForAlert(type) {
  const map = {
    "Thunderstorm": "⛈️", "High Wind": "💨", "Heavy Rainfall": "🌧️",
    "Rain Advisory": "🌦️", "Heatwave": "🥵", "Cold Wave": "🥶",
    "Damaging Wind Gusts": "🌪️", "Thunderstorm Outlook": "⛈️",
    "High UV": "🕶️", "No Significant Alerts": "✅",
  };
  return map[type] || "⚠️";
}

async function refreshAdvisory() {
  const box = $("#advisoryText");
  box.textContent = "Loading advisory…";
  try {
    const data = await getJSON(`${API}/api/advisory?lat=${state.lat}&lon=${state.lon}&persona=${state.persona}`);
    box.textContent = data.advisory;
  } catch (e) {
    box.textContent = "Could not load advisory.";
  }
}

async function refreshAqi() {
  const box = $("#aqiBox");
  box.textContent = "Loading…";
  try {
    const data = await getJSON(`${API}/api/air-quality?lat=${state.lat}&lon=${state.lon}`);
    if (data.us_aqi == null) {
      box.textContent = "Air quality data unavailable for this location.";
      return;
    }
    box.innerHTML = `
      <span class="aqi-pill" style="background:${aqiColor(data.us_aqi)}">AQI ${Math.round(data.us_aqi)}</span>
      PM2.5: ${data.pm2_5 ?? "--"} µg/m³ &nbsp;·&nbsp; PM10: ${data.pm10 ?? "--"} µg/m³
    `;
  } catch (e) {
    box.textContent = "Could not load air quality.";
  }
}

// ---------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------
function appendMessage(role, content) {
  const box = $("#chatMessages");
  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "user" : "bot"}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = escapeAndLinkify(content);
  div.appendChild(bubble);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function escapeAndLinkify(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br/>");
}

function showTyping() {
  const box = $("#chatMessages");
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = "typingIndicator";
  div.innerHTML = `<div class="bubble typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function hideTyping() {
  const el = $("#typingIndicator");
  if (el) el.remove();
}

async function sendChat(text) {
  if (!text.trim()) return;
  appendMessage("user", text);
  state.chatHistory.push({ role: "user", content: text });
  showTyping();

  // Give the model location context implicitly via a lightweight system-ish hint
  const contextualHistory = [...state.chatHistory];
  contextualHistory[contextualHistory.length - 1] = {
    role: "user",
    content: `${text}\n\n[Context: user's currently selected location is "${state.placeLabel}" at latitude ${state.lat}, longitude ${state.lon}. Use this if the user does not name another place.]`,
  };

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: contextualHistory, language: state.language }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    hideTyping();
    appendMessage("bot", data.reply || "Sorry, I couldn't generate a response.");
    state.chatHistory.push({ role: "assistant", content: data.reply || "" });
  } catch (e) {
    hideTyping();
    appendMessage("bot", "⚠️ Sorry, I couldn't reach the WeatherGPT engine right now. Please try again.");
    console.error(e);
  }
}

// ---------------------------------------------------------------------
// Voice input (Web Speech API) — for rural / low-literacy accessibility
// ---------------------------------------------------------------------
let recognizer = null;
let listening = false;

const SPEECH_LANG_MAP = {
  en: "en-IN", hi: "hi-IN", mr: "mr-IN", bn: "bn-IN", ta: "ta-IN",
  te: "te-IN", kn: "kn-IN", gu: "gu-IN", pa: "pa-IN", ml: "ml-IN",
  or: "or-IN", as: "as-IN", ur: "ur-IN",
};

function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("#voiceBtn");
  if (!SR) {
    btn.title = "Voice input not supported on this browser";
    return;
  }
  recognizer = new SR();
  recognizer.continuous = false;
  recognizer.interimResults = false;

  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    $("#chatInput").value = transcript;
    sendChat(transcript);
    $("#chatInput").value = "";
  };
  recognizer.onerror = () => stopListening();
  recognizer.onend = () => stopListening();
}

function startListening() {
  if (!recognizer) return;
  recognizer.lang = SPEECH_LANG_MAP[state.language] || "en-IN";
  try {
    recognizer.start();
    listening = true;
    $("#voiceBtn").classList.add("listening");
  } catch (e) { /* already started */ }
}
function stopListening() {
  listening = false;
  $("#voiceBtn").classList.remove("listening");
}

// ---------------------------------------------------------------------
// Wire up events
// ---------------------------------------------------------------------
function init() {
  loadLanguages();
  initVoice();
  refreshDashboard();

  $("#locSearchBtn").addEventListener("click", searchLocation);
  $("#locInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchLocation(); } });
  $("#locGpsBtn").addEventListener("click", useGps);

  $("#langSelect").addEventListener("change", (e) => {
    state.language = e.target.value;
    localStorage.setItem("wg_lang", state.language);
  });

  $("#voiceBtn").addEventListener("click", () => {
    if (listening) { recognizer.stop(); stopListening(); }
    else startListening();
  });

  $all("#personaRow .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      $all("#personaRow .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.persona = chip.dataset.persona;
      refreshAdvisory();
    });
  });

  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const text = input.value;
    input.value = "";
    sendChat(text);
  });

  $all("#quickChips .chip").forEach(chip => {
    chip.addEventListener("click", () => sendChat(chip.textContent));
  });

  $("#clearChatBtn").addEventListener("click", () => {
    state.chatHistory = [];
    $("#chatMessages").innerHTML = `<div class="msg bot"><div class="bubble">👋 Chat cleared. Ask me anything about the weather!</div></div>`;
  });

  $("#menuBtn").addEventListener("click", () => {
    const dash = $("#dashboard");
    dash.style.display = dash.style.display === "none" ? "flex" : "none";
  });
}

document.addEventListener("DOMContentLoaded", init);
