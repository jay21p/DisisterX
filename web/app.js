/**
 * DisasterX Clean Minimal Frontend Controller
 */

const STATE = {
  activeRegion: 'uttarakhand',
  activeLeadTime: 2.0,
  activeLayer: 'composite',
  isPlaying: false,
  playTimer: null,
  map: null,
  mapLayers: {
    gridGroup: null,
    activeHighlight: null
  },
  currentFeatures: []
};

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initMap();
  initControls();
  loadData();
  fetchAlerts();

  // Background refresh for active alerts
  setInterval(fetchAlerts, 15000);
});

function initClock() {
  const clockEl = document.getElementById('liveClock');
  const update = () => {
    const now = new Date();
    clockEl.innerText = now.toTimeString().split(' ')[0] + ' IST';
  };
  update();
  setInterval(update, 1000);
}

// ==========================================================
// 1. MAP INITIALIZATION
// ==========================================================
function initMap() {
  STATE.map = L.map('gisMap', {
    zoomControl: false,
    attributionControl: false
  }).setView([30.3165, 78.5500], 8);

  L.control.zoom({ position: 'bottomright' }).addTo(STATE.map);

  // Free OpenStreetMap Tiles (100% Free, Zero API Key Required)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(STATE.map);

  STATE.mapLayers.gridGroup = L.layerGroup().addTo(STATE.map);

  // Map click inspector
  STATE.map.on('click', (e) => {
    const hint = document.getElementById('mapClickPrompt');
    if (hint) hint.style.display = 'none';
    inspectPoint(e.latlng.lat, e.latlng.lng);
  });
}

// ==========================================================
// 2. UI EVENT HANDLERS & MODALS
// ==========================================================
function initControls() {
  // Region Selector
  document.getElementById('regionSelect').addEventListener('change', (e) => {
    switchRegion(e.target.value);
  });

  // Layer Filter Pills
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      STATE.activeLayer = e.target.getAttribute('data-layer');
      renderMapGrid();
    });
  });

  // Timeline Lead-Time Pills
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const lt = parseFloat(e.target.getAttribute('data-lead'));
      setLeadTime(lt);
    });
  });

  // Timeline Play / Pause
  document.getElementById('btnPlayTimeline').addEventListener('click', togglePlayTimeline);

  // Quick Simulation Button
  document.getElementById('btnQuickSim').addEventListener('click', () => {
    triggerScenario('cloudburst_himalayan');
  });

  // Warnings Drawer Toggle
  const alertsDrawer = document.getElementById('alertsDrawer');
  document.getElementById('btnToggleAlerts').addEventListener('click', () => {
    alertsDrawer.classList.toggle('open');
    document.getElementById('xaiDrawer').classList.remove('open');
  });

  document.getElementById('btnCloseAlerts').addEventListener('click', () => {
    alertsDrawer.classList.remove('open');
  });

  // XAI Drawer Close
  document.getElementById('btnCloseXai').addEventListener('click', () => {
    document.getElementById('xaiDrawer').classList.remove('open');
    if (STATE.mapLayers.activeHighlight) {
      STATE.map.removeLayer(STATE.mapLayers.activeHighlight);
    }
  });

  // Guide Modal Controls
  const guideModal = document.getElementById('guideModal');
  document.getElementById('btnOpenGuide').addEventListener('click', () => {
    guideModal.classList.add('open');
  });

  document.getElementById('btnCloseGuide').addEventListener('click', () => {
    guideModal.classList.remove('open');
  });

  document.getElementById('btnGotIt').addEventListener('click', () => {
    guideModal.classList.remove('open');
  });
}

// ==========================================================
// 3. SPATIAL DATA RENDERING
// ==========================================================
async function loadData() {
  try {
    const res = await fetch(`/api/nowcast/grid?lead_time=${STATE.activeLeadTime}`);
    const data = await res.json();
    STATE.currentFeatures = data.features;

    if (data.region && data.region.center) {
      STATE.map.setView(data.region.center, getZoom(STATE.activeRegion));
    }

    renderMapGrid();

    // Update system status chip grid-cell count (authority/credibility signal)
    const sysGridCount = document.getElementById('sysGridCount');
    if (sysGridCount && data.features) {
      sysGridCount.innerText = `${data.features.length} cells`;
    }
  } catch (err) {
    console.error('Error loading nowcast grid:', err);
  }
}

function getZoom(regionKey) {
  switch (regionKey) {
    case 'mumbai_konkan': return 9;
    default: return 8;
  }
}

function renderMapGrid() {
  STATE.mapLayers.gridGroup.clearLayers();

  if (!STATE.currentFeatures) return;

  STATE.currentFeatures.forEach(f => {
    const coords = f.geometry.coordinates; // [lon, lat]
    const p = f.properties;

    let val = 0;
    if (STATE.activeLayer === 'composite') val = p.composite_risk;
    else if (STATE.activeLayer === 'cloudburst') val = p.prob_cloudburst;
    else if (STATE.activeLayer === 'flashflood') val = p.prob_flashflood;
    else if (STATE.activeLayer === 'thunderstorm') val = p.prob_thunderstorm;
    else if (STATE.activeLayer === 'iwv') val = (p.iwv - 30) / 50;

    // Filter calm zones to keep UI clean
    if (val < 0.20 && STATE.activeLayer !== 'iwv') return;

    const color = getSeverityColor(val, STATE.activeLayer);
    const circle = L.circle([coords[1], coords[0]], {
      radius: 6500,
      color: color,
      fillColor: color,
      fillOpacity: Math.min(0.75, Math.max(0.18, val * 0.8)),
      weight: 1
    });

    circle.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      inspectPoint(coords[1], coords[0]);
    });

    STATE.mapLayers.gridGroup.addLayer(circle);

    // Add a subtle radar-style pulse ring around genuinely Critical cells only
    // (>=75%) — reinforces urgency exactly where it's warranted, and nowhere
    // else, so the visual signal stays calibrated and trustworthy.
    if (STATE.activeLayer === 'composite' && val >= 0.75) {
      const ring = L.circle([coords[1], coords[0]], {
        radius: 9000,
        color: color,
        fillOpacity: 0,
        weight: 1.5,
        className: 'risk-pulse-ring',
        interactive: false
      });
      STATE.mapLayers.gridGroup.addLayer(ring);
    }
  });
}

function getSeverityColor(val, layer) {
  if (layer === 'iwv') {
    if (val > 0.7) return '#38bdf8';
    if (val > 0.4) return '#0284c7';
    return '#1e3a8a';
  }

  if (val >= 0.75) return '#f43f5e'; // Critical Rose
  if (val >= 0.50) return '#f59e0b'; // High Amber
  if (val >= 0.30) return '#38bdf8'; // Moderate Sky
  return '#10b981'; // Normal Emerald
}

// ==========================================================
// 4. TIMELINE CONTROLLER
// ==========================================================
function setLeadTime(lt) {
  STATE.activeLeadTime = lt;

  document.querySelectorAll('.step-btn').forEach(btn => {
    const val = parseFloat(btn.getAttribute('data-lead'));
    if (val === lt) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  document.getElementById('activeLeadIndicator').innerText = `Lead Impact: +${lt} Hours`;

  // Animate the connected progress track behind the lead-time steps (2h-6h range)
  const trackFill = document.getElementById('leadTrackFill');
  if (trackFill) {
    const pct = ((lt - 2.0) / (6.0 - 2.0)) * 100;
    trackFill.style.width = `${Math.max(6, pct)}%`;
  }

  loadData();
}

function togglePlayTimeline() {
  const icon = document.getElementById('playIcon');
  if (STATE.isPlaying) {
    clearInterval(STATE.playTimer);
    STATE.isPlaying = false;
    icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  } else {
    STATE.isPlaying = true;
    icon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    STATE.playTimer = setInterval(() => {
      let nextLt = STATE.activeLeadTime + 1.0;
      if (nextLt > 6.0) nextLt = 2.0;
      setLeadTime(nextLt);
    }, 2200);
  }
}

// ==========================================================
// 5. REGION & SIMULATION
// ==========================================================
async function switchRegion(regionKey) {
  STATE.activeRegion = regionKey;
  try {
    await fetch('/api/region/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region_key: regionKey })
    });
    loadData();
    fetchAlerts();
  } catch (e) {
    console.error(e);
  }
}

async function triggerScenario(scenario) {
  try {
    await fetch('/api/simulate-scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: scenario, region_key: STATE.activeRegion })
    });
    loadData();
    fetchAlerts();

    // Auto-open alerts drawer
    document.getElementById('alertsDrawer').classList.add('open');
  } catch (e) {
    console.error(e);
  }
}

// ==========================================================
// 6. XAI POINT INSPECTOR
// ==========================================================
async function inspectPoint(lat, lon) {
  const xaiDrawer = document.getElementById('xaiDrawer');
  const coordText = document.getElementById('xaiCoordText');
  const xaiBody = document.getElementById('xaiBody');

  if (STATE.mapLayers.activeHighlight) {
    STATE.map.removeLayer(STATE.mapLayers.activeHighlight);
  }

  STATE.mapLayers.activeHighlight = L.circleMarker([lat, lon], {
    radius: 10,
    color: '#38bdf8',
    weight: 2,
    fillColor: '#ffffff',
    fillOpacity: 0.9
  }).addTo(STATE.map);

  coordText.innerText = `Coordinates: ${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E`;
  xaiBody.innerHTML = '<div class="drawer-empty">Running Spatiotemporal XAI Diagnostics...</div>';
  
  xaiDrawer.classList.add('open');
  document.getElementById('alertsDrawer').classList.remove('open');

  try {
    const res = await fetch(`/api/nowcast/xai?lat=${lat}&lon=${lon}&lead_time=${STATE.activeLeadTime}`);
    const xai = await res.json();
    renderXAI(xai);
  } catch (e) {
    xaiBody.innerHTML = '<div class="drawer-empty">Unable to load XAI diagnostics.</div>';
  }
}

function renderXAI(xai) {
  const m = xai.meteorological_metrics;
  const a = xai.attributions_pct;
  const body = document.getElementById('xaiBody');

  body.innerHTML = `
    <!-- Main Threat Hero Card -->
    <div class="xai-severity-hero" style="border-left: 4px solid ${xai.severity_color}">
      <div class="xai-hero-top">
        <span class="hero-risk-pill" style="background: ${xai.severity_color}25; color: ${xai.severity_color}">
          ${xai.severity} RISK
        </span>
        <span class="hero-lead">+${xai.lead_time_hours}h Lead Time</span>
      </div>
      <div class="hero-threat-name">${xai.primary_threat}</div>
    </div>

    <!-- Precursor Attribution Breakdown -->
    <div>
      <div class="xai-subheading">Meteorological Precursor Weights</div>
      
      <div class="attr-entry">
        <div class="attr-label-row"><span>💧 Moisture Fuel (IWV Anomaly)</span><span class="font-mono">${a.moisture_fuel}%</span></div>
        <div class="attr-meter"><div class="attr-fill-color fill-moist" style="width: ${a.moisture_fuel}%"></div></div>
      </div>

      <div class="attr-entry">
        <div class="attr-label-row"><span>🌪️ Updraft Lift & Cloud Cooling</span><span class="font-mono">${a.updraft_lift}%</span></div>
        <div class="attr-meter"><div class="attr-fill-color fill-updraft" style="width: ${a.updraft_lift}%"></div></div>
      </div>

      <div class="attr-entry">
        <div class="attr-label-row"><span>⚡ Atmospheric Instability (CAPE)</span><span class="font-mono">${a.atmospheric_instability}%</span></div>
        <div class="attr-meter"><div class="attr-fill-color fill-instab" style="width: ${a.atmospheric_instability}%"></div></div>
      </div>

      <div class="attr-entry">
        <div class="attr-label-row"><span>⛰️ DEM Topographic Drainage</span><span class="font-mono">${a.topographic_runoff}%</span></div>
        <div class="attr-meter"><div class="attr-fill-color fill-topo" style="width: ${a.topographic_runoff}%"></div></div>
      </div>
    </div>

    <!-- Sensor Readings (2x2 Grid) -->
    <div>
      <div class="xai-subheading">Live Sensor Precursor Readings</div>
      <div class="sensor-metric-grid">
        <div class="sensor-box">
          <div class="sensor-box-label">Water Vapor (IWV)</div>
          <div class="sensor-box-value">${m.iwv} <span class="sensor-box-unit">${m.iwv_unit}</span></div>
        </div>
        <div class="sensor-box">
          <div class="sensor-box-label">Cloud Cooling Rate</div>
          <div class="sensor-box-value">${m.ctt_drop_rate} <span class="sensor-box-unit">${m.ctt_drop_unit}</span></div>
        </div>
        <div class="sensor-box">
          <div class="sensor-box-label">Thermal Energy (CAPE)</div>
          <div class="sensor-box-value">${m.cape} <span class="sensor-box-unit">${m.cape_unit}</span></div>
        </div>
        <div class="sensor-box">
          <div class="sensor-box-label">Terrain Slope</div>
          <div class="sensor-box-value">${m.slope_deg}° <span class="sensor-box-unit">(${m.elevation}m)</span></div>
        </div>
      </div>
    </div>

    <!-- Natural Language XAI Summary -->
    <div class="xai-ai-summary-box">
      <strong>AI Diagnostic Explanation:</strong><br>
      ${xai.explanation}
    </div>
  `;
}

// ==========================================================
// 7. ACTIVE WARNINGS FEED
// ==========================================================
async function fetchAlerts() {
  try {
    const res = await fetch('/api/alerts');
    const data = await res.json();

    const countBadge = document.getElementById('alertCountBadge');
    countBadge.innerText = data.total_active_alerts;
    const alertBtn = document.getElementById('btnToggleAlerts');
    if (data.total_active_alerts > 0) {
      countBadge.classList.remove('zero');
      if (alertBtn) alertBtn.classList.add('has-active');
    } else {
      countBadge.classList.add('zero');
      if (alertBtn) alertBtn.classList.remove('has-active');
    }

    const list = document.getElementById('alertsList');
    if (!data.alerts || data.alerts.length === 0) {
      list.innerHTML = '<div class="drawer-empty">No critical weather warnings active for this sector.</div>';
      return;
    }

    list.innerHTML = data.alerts.map(alt => {
      const sevClass = alt.severity === 'CRITICAL' ? 'crit' : (alt.severity === 'HIGH' ? 'high' : 'mod');
      const tagClass = alt.event_type === 'CLOUDBURST' ? 'cat-cloudburst' : (alt.event_type === 'FLASH_FLOOD' ? 'cat-flood' : 'cat-storm');

      return `
        <div class="alert-card-item ${sevClass}" onclick="focusAlertPoint(${alt.epicenter.lat}, ${alt.epicenter.lon})">
          <div class="alert-top-row">
            <span class="alert-category-tag ${tagClass}">${alt.event_type.replace('_', ' ')}</span>
            <span class="alert-lead-badge">+${alt.lead_time_hours}h Lead</span>
          </div>
          <div class="alert-location-title">${alt.location_name}</div>
          <div class="alert-trigger-desc">${alt.atmospheric_trigger}</div>
          <div class="alert-sop-box">${alt.action_advisory}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading alerts:', e);
  }
}

function focusAlertPoint(lat, lon) {
  STATE.map.flyTo([lat, lon], 9, { duration: 1.2 });
  inspectPoint(lat, lon);
}
