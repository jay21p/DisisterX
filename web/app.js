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
    riskOverlay: null,   // L.imageOverlay -- true per-cell risk raster
    epicenterMarkers: null,
    activeHighlight: null
  },
  currentFeatures: [],
  currentBounds: null,  // [minLat, minLon, maxLat, maxLon] from last grid response
  gridDim: 40           // matches backend's 40x40 spatial resolution
};

// Risk-value -> color ramp (0=calm green, 1=critical red). Shared by both
// the map raster and the sidebar legend so "what you see" always matches
// "what the number means" -- no separate visual language to miscalibrate.
const RISK_GRADIENT_STOPS = [
  { at: 0.00, rgb: [16, 185, 129] },   // normal (green)
  { at: 0.30, rgb: [56, 189, 248] },   // moderate (cyan)
  { at: 0.50, rgb: [245, 158, 11] },   // high (amber)
  { at: 0.75, rgb: [244, 63, 94] },    // critical (red)
  { at: 1.00, rgb: [244, 63, 94] }
];

function valueToRgb(v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 0; i < RISK_GRADIENT_STOPS.length - 1; i++) {
    const a = RISK_GRADIENT_STOPS[i];
    const b = RISK_GRADIENT_STOPS[i + 1];
    if (v >= a.at && v <= b.at) {
      const t = (b.at - a.at) === 0 ? 0 : (v - a.at) / (b.at - a.at);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t)
      ];
    }
  }
  return RISK_GRADIENT_STOPS[RISK_GRADIENT_STOPS.length - 1].rgb;
}

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initMap();
  initControls();
  syncInitialRegion();
  fetchAlerts();

  // Background refresh for active alerts
  setInterval(fetchAlerts, 15000);
});

// The backend keeps one global "active region" shared across every open
// session (no per-user isolation). If a previous session left it on a
// different sector, a fresh page load would silently show that leftover
// region's map/data while the dropdown still displays our hardcoded
// default -- a trust-breaking mismatch. Force the backend into the exact
// region the UI claims to show before the first render, every time.
async function syncInitialRegion() {
  try {
    await fetch('/api/region/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region_key: STATE.activeRegion })
    });
  } catch (err) {
    console.error('Error syncing initial region:', err);
  }
  loadData();
}

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

  // Spatial risk raster: a single canvas-rendered image overlay, bilinearly
  // blurred from the true 40x40 model grid. This intentionally replaces
  // both the earlier per-cell circle-stack ("flower of circles") AND a
  // leaflet.heat point-cloud approach -- leaflet.heat additively sums the
  // intensity of every nearby point, so a cluster of merely-moderate cells
  // (e.g. Kerala's real ~35% max risk) blends into a saturated, critical-
  // looking red blob. That silently reintroduces the "always looks
  // alarmed" credibility problem for calm sectors. A raster painted
  // directly and only from each cell's own value has no such blending
  // artifact: the color on the map always matches the actual number.
  STATE.mapLayers.riskOverlay = null; // created/replaced per render (image bounds change per region)
  STATE.mapLayers.epicenterMarkers = L.layerGroup().addTo(STATE.map);

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
    STATE.currentBounds = (data.region && data.region.bounds) ? data.region.bounds : null;

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
  STATE.mapLayers.epicenterMarkers.clearLayers();

  if (STATE.mapLayers.riskOverlay) {
    STATE.map.removeLayer(STATE.mapLayers.riskOverlay);
    STATE.mapLayers.riskOverlay = null;
  }

  if (!STATE.currentFeatures || STATE.currentFeatures.length === 0 || !STATE.currentBounds) {
    return;
  }

  const dim = STATE.gridDim;
  const n = STATE.currentFeatures.length;
  if (n !== dim * dim) {
    // Defensive fallback: dimensions changed server-side, skip raster paint
    // rather than mis-map values onto the wrong cell.
    return;
  }

  // Backend returns row-major [min_lat..max_lat] x [min_lon..max_lon]
  // (see engine/data_generator.py generate_grid_coordinates / meshgrid).
  const values = new Float32Array(dim * dim);
  let peakVal = -1;
  let peakCoords = null;

  for (let i = 0; i < n; i++) {
    const f = STATE.currentFeatures[i];
    const p = f.properties;
    let val = 0;
    if (STATE.activeLayer === 'composite') val = p.composite_risk;
    else if (STATE.activeLayer === 'cloudburst') val = p.prob_cloudburst;
    else if (STATE.activeLayer === 'flashflood') val = p.prob_flashflood;
    else if (STATE.activeLayer === 'thunderstorm') val = p.prob_thunderstorm;
    else if (STATE.activeLayer === 'iwv') val = Math.max(0, Math.min(1, (p.iwv - 30) / 50));

    values[i] = val;

    if (val > peakVal) {
      peakVal = val;
      const coords = f.geometry.coordinates; // [lon, lat]
      peakCoords = [coords[1], coords[0]];
    }
  }

  // Paint a smoothly-upsampled raster: each output pixel samples the
  // *actual* underlying grid value via bilinear interpolation (no additive
  // blending across neighboring points), so the displayed color always
  // reflects a real, calibrated risk number -- a genuinely moderate sector
  // can never visually read as a critical blob.
  const outDim = 256;
  const canvas = document.createElement('canvas');
  canvas.width = outDim;
  canvas.height = outDim;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(outDim, outDim);

  // Row 0 of `values` = min_lat (south); image row 0 = top = max_lat (north).
  // So sample with v-flip: outputRow 0 -> gridRow (dim-1).
  for (let oy = 0; oy < outDim; oy++) {
    const v = 1 - oy / (outDim - 1); // 0..1, 1 = south edge (row 0), 0 = north edge (row dim-1)
    const gy = v * (dim - 1);
    const gy0 = Math.floor(gy), gy1 = Math.min(dim - 1, gy0 + 1);
    const fy = gy - gy0;

    for (let ox = 0; ox < outDim; ox++) {
      const u = ox / (outDim - 1); // 0..1 west->east
      const gx = u * (dim - 1);
      const gx0 = Math.floor(gx), gx1 = Math.min(dim - 1, gx0 + 1);
      const fx = gx - gx0;

      const v00 = values[gy0 * dim + gx0];
      const v10 = values[gy0 * dim + gx1];
      const v01 = values[gy1 * dim + gx0];
      const v11 = values[gy1 * dim + gx1];
      const vTop = v00 + (v10 - v00) * fx;
      const vBot = v01 + (v11 - v01) * fx;
      const val = vTop + (vBot - vTop) * fy;

      const idx = (oy * outDim + ox) * 4;
      if (val < 0.12) {
        imgData.data[idx + 3] = 0; // transparent calm baseline
        continue;
      }
      const [r, g, b] = valueToRgb(val);
      // Opacity ramps with severity so Critical genuinely reads as more
      // "solid"/urgent than Moderate, without ever changing hue via blending.
      const alpha = Math.round(60 + Math.min(1, val) * 150);
      imgData.data[idx] = r;
      imgData.data[idx + 1] = g;
      imgData.data[idx + 2] = b;
      imgData.data[idx + 3] = alpha;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const [minLat, minLon, maxLat, maxLon] = STATE.currentBounds;
  const imgBounds = [[minLat, minLon], [maxLat, maxLon]];
  STATE.mapLayers.riskOverlay = L.imageOverlay(canvas.toDataURL(), imgBounds, {
    opacity: 1,
    interactive: false,
    className: 'risk-raster-layer'
  }).addTo(STATE.map);

  // Single pulsing epicenter marker at the peak-risk point, shown only when
  // that peak is genuinely Critical (>=75%) on the Composite Risk layer --
  // reinforces urgency exactly where it's warranted, keeping the "always
  // alarmed" cry-wolf failure mode from creeping back in.
  if (STATE.activeLayer === 'composite' && peakVal >= 0.75 && peakCoords) {
    const ring = L.circle(peakCoords, {
      radius: 9000,
      color: '#f43f5e',
      fillOpacity: 0,
      weight: 2,
      className: 'risk-pulse-ring',
      interactive: false
    });
    const core = L.circleMarker(peakCoords, {
      radius: 5,
      color: '#ffffff',
      weight: 1.5,
      fillColor: '#f43f5e',
      fillOpacity: 1,
      interactive: false
    });
    STATE.mapLayers.epicenterMarkers.addLayer(ring);
    STATE.mapLayers.epicenterMarkers.addLayer(core);
  }
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
