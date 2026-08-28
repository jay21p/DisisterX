/**
 * DisasterX Landing Page Controller
 * Live data hooks + scroll reveal + nav scroll state
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavScroll();
  initScrollReveal();
  loadHeroLiveData();
  loadRegionsLiveData();

  setInterval(loadHeroLiveData, 20000);
});

// ================= NAV SCROLL STATE =================
function initNavScroll() {
  const nav = document.getElementById('mainNav');
  const onScroll = () => {
    if (window.scrollY > 20) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll);
  onScroll();
}

// ================= SCROLL REVEAL =================
function initScrollReveal() {
  const items = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  items.forEach(el => observer.observe(el));
}

// ================= HERO LIVE HUD + ALERT STRIP =================
async function loadHeroLiveData() {
  try {
    const [alertsRes, gridRes] = await Promise.all([
      fetch('/api/alerts'),
      fetch('/api/nowcast/grid?lead_time=2.0')
    ]);
    const alerts = await alertsRes.json();
    const grid = await gridRes.json();

    // Alert strip + count
    const total = alerts.total_active_alerts || 0;
    const alertCountEl = document.getElementById('heroAlertCount');
    const alertStripEl = document.getElementById('heroAlertStrip');
    const heroLiveAlerts = document.getElementById('heroLiveAlerts');
    if (heroLiveAlerts) heroLiveAlerts.innerText = total;

    if (alertCountEl) {
      if (total > 0) {
        const critCount = (alerts.alerts || []).filter(a => a.severity === 'CRITICAL').length;
        alertCountEl.innerText = critCount > 0
          ? `${critCount} CRITICAL warning${critCount > 1 ? 's' : ''} active right now across monitored sectors`
          : `${total} active warning${total > 1 ? 's' : ''} across monitored sectors`;
        if (alertStripEl) alertStripEl.classList.remove('is-calm');
      } else {
        alertCountEl.innerText = 'All monitored sectors currently within normal thresholds';
        if (alertStripEl) alertStripEl.classList.add('is-calm');
      }
    }

    // Find max-risk feature for HUD
    if (grid.features && grid.features.length > 0) {
      let maxFeature = grid.features[0];
      grid.features.forEach(f => {
        if (f.properties.composite_risk > maxFeature.properties.composite_risk) maxFeature = f;
      });
      const p = maxFeature.properties;

      setHudValue('hudIwv', `${p.iwv} kg/m²`);
      setHudValue('hudCape', `${Math.round(p.cape)} J/kg`);
      setHudValue('hudCtt', `${p.ctt_cooling} K/hr`);

      const riskPct = Math.round(p.composite_risk * 100);
      setHudValue('hudRisk', `${riskPct}%`);
      const hudRiskBar = document.getElementById('hudRiskBar');
      if (hudRiskBar) hudRiskBar.style.width = `${riskPct}%`;

      const hudRiskEl = document.getElementById('hudRisk');
      if (hudRiskEl) {
        hudRiskEl.className = 'value ' + (riskPct >= 75 ? 'val-crit' : riskPct >= 50 ? 'val-high' : 'val-mod');
      }
    }
  } catch (e) {
    console.error('Error loading hero live data:', e);
  }
}

function setHudValue(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

// ================= REGIONS LIVE RISK =================
const REGION_KEYS = ['uttarakhand', 'mumbai_konkan', 'northeast_assam', 'kerala_ghats'];

async function loadRegionsLiveData() {
  const grid = document.getElementById('regionsGrid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.region-card');

  for (let i = 0; i < REGION_KEYS.length; i++) {
    const key = REGION_KEYS[i];
    const card = cards[i];
    if (!card) continue;

    try {
      await fetch('/api/region/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region_key: key })
      });
      const res = await fetch('/api/nowcast/grid?lead_time=2.0');
      const data = await res.json();

      let maxRisk = 0;
      (data.features || []).forEach(f => {
        if (f.properties.composite_risk > maxRisk) maxRisk = f.properties.composite_risk;
      });

      const pct = Math.round(maxRisk * 100);
      const fill = card.querySelector('.region-risk-fill');
      const label = card.querySelector('.region-risk-label span:last-child');

      let color = 'var(--safe)';
      let text = 'Normal';
      if (pct >= 75) { color = 'var(--danger)'; text = 'Critical'; }
      else if (pct >= 50) { color = 'var(--warning)'; text = 'High'; }
      else if (pct >= 30) { color = 'var(--accent)'; text = 'Moderate'; }

      if (fill) {
        fill.style.width = `${pct}%`;
        fill.style.background = color;
      }
      if (label) label.innerText = `${text} (${pct}%)`;
    } catch (e) {
      console.error(`Error loading region ${key}:`, e);
    }
  }

  // Reset to default region after scan
  try {
    await fetch('/api/region/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region_key: 'uttarakhand' })
    });
  } catch (e) { /* noop */ }
}
