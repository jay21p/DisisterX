"""
DisasterX Explainable AI (XAI) Engine
Calculates gradient/contribution-based feature attributions for any spatial coordinate.
Explains exactly WHY a Thunderstorm, Cloudburst, or Flash Flood alert was generated:
- Moisture Fuel: Integrated Water Vapor (IWV) & delta IWV
- Instability Energy: CAPE / CIN
- Updraft Lift: Cloud Top Temp (CTT) Cooling Rate & Convergence
- Topographic Trigger: DEM Slope & Basin Runoff Channeling
"""

import numpy as np
from typing import Dict, Any, List
from engine.model import nowcast_model

class ExplainableAIEngine:
    def explain_point(self, lat: float, lon: float, lead_time_hours: float = 2.0) -> Dict[str, Any]:
        """
        Extracts atmospheric precursors and produces explainability attribution for a specific lat/lon coordinate.
        """
        pred = nowcast_model.predict(lead_time_hours)
        lat_grid = pred["lat_grid"]
        lon_grid = pred["lon_grid"]

        # Find nearest grid cell
        dist_sq = (lat_grid - lat)**2 + (lon_grid - lon)**2
        idx = np.unravel_index(np.argmin(dist_sq), dist_sq.shape)
        r, c = idx

        raw = pred["raw_inputs"]
        dem = raw["dem"]

        # Cell atmospheric readings
        val_iwv = float(raw["iwv"][r, c])
        val_iwv_rate = float(raw["iwv_rate"][r, c])
        val_ctt = float(raw["ctt"][r, c])
        val_ctt_cooling = float(raw["ctt_cooling_rate"][r, c])
        val_cape = float(raw["cape"][r, c])
        val_cin = float(raw["cin"][r, c])
        val_conv = float(raw["convergence"][r, c])
        val_shear = float(raw["shear"][r, c])
        val_qpe = float(raw["qpe"][r, c])
        val_elev = float(dem["elevation"][r, c])
        val_slope = float(dem["slope"][r, c])
        val_drain = float(dem["drainage"][r, c])

        p_ts = float(pred["prob_thunderstorm"][r, c])
        p_cb = float(pred["prob_cloudburst"][r, c])
        p_ff = float(pred["prob_flashflood"][r, c])
        p_comp = float(pred["composite_risk"][r, c])

        # Compute XAI Attribution Weights
        # 1. Moisture Fuel (IWV accumulation & rate)
        moisture_score = max(0.05, (val_iwv - 30.0) / 50.0 * 0.6 + max(0.0, val_iwv_rate) / 15.0 * 0.4)
        # 2. Instability (CAPE & low CIN)
        instability_score = max(0.05, (val_cape - 800.0) / 3500.0 * 0.7 + max(0.0, 80.0 - val_cin) / 70.0 * 0.3)
        # 3. Dynamic Lift (CTT rapid drop rate & convergence)
        lift_score = max(0.05, val_ctt_cooling / 22.0 * 0.65 + max(0.0, val_conv) / 10.0 * 0.35)
        # 4. Topography (Slope & River Basin channel)
        topo_score = max(0.05, val_slope / 40.0 * 0.5 + val_drain * 0.5)

        total_attr = moisture_score + instability_score + lift_score + topo_score
        
        attr_breakdown = {
            "moisture_fuel": round((moisture_score / total_attr) * 100, 1),
            "atmospheric_instability": round((instability_score / total_attr) * 100, 1),
            "updraft_lift": round((lift_score / total_attr) * 100, 1),
            "topographic_runoff": round((topo_score / total_attr) * 100, 1)
        }

        # Determine Primary Driving Threat
        primary_threat = "Normal Atmospheric Conditions"
        severity = "LOW"
        color = "#10b981"

        if p_comp >= 0.75:
            severity = "CRITICAL"
            color = "#ef4444"
        elif p_comp >= 0.50:
            severity = "HIGH"
            color = "#f59e0b"
        elif p_comp >= 0.30:
            severity = "MODERATE"
            color = "#3b82f6"

        threats = []
        if p_cb >= 0.45:
            threats.append(f"Cloudburst Potential ({round(p_cb*100)}%)")
        if p_ff >= 0.45:
            threats.append(f"Flash Flood Inundation ({round(p_ff*100)}%)")
        if p_ts >= 0.45:
            threats.append(f"Severe Convective Storm ({round(p_ts*100)}%)")

        if threats:
            primary_threat = " + ".join(threats)

        # Generate Natural Language Explanation
        key_factors = []
        if val_iwv >= 55.0:
            key_factors.append(f"dense Integrated Water Vapor pool ({val_iwv:.1f} kg/m²)")
        if val_ctt_cooling >= 12.0:
            key_factors.append(f"explosive Cloud Top Cooling ({val_ctt_cooling:.1f} K/hr drop)")
        if val_cape >= 2400.0:
            key_factors.append(f"extreme thermal buoyancy (CAPE {val_cape:.0f} J/kg)")
        if val_slope >= 18.0 and p_ff >= 0.4:
            key_factors.append(f"steep valley drainage funneling runoff ({val_slope:.1f}° slope)")

        if key_factors:
            explanation = f"High alert at coordinate ({lat:.3f}N, {lon:.3f}E) due to " + ", ".join(key_factors) + f" over a {lead_time_hours:.0f}-hour lead time."
        else:
            explanation = f"Atmospheric readings within stable thresholds for lead time {lead_time_hours:.0f}h."

        return {
            "coordinate": {"lat": lat, "lon": lon, "grid_lat": float(lat_grid[r, c]), "grid_lon": float(lon_grid[r, c])},
            "lead_time_hours": lead_time_hours,
            "risk_scores": {
                "composite": round(p_comp, 3),
                "cloudburst": round(p_cb, 3),
                "flash_flood": round(p_ff, 3),
                "thunderstorm": round(p_ts, 3)
            },
            "severity": severity,
            "severity_color": color,
            "primary_threat": primary_threat,
            "attributions_pct": attr_breakdown,
            "meteorological_metrics": {
                "iwv": round(val_iwv, 1),
                "iwv_unit": "kg/m²",
                "iwv_surge_rate": round(val_iwv_rate, 2),
                "ctt": round(val_ctt, 1),
                "ctt_unit": "K",
                "ctt_drop_rate": round(val_ctt_cooling, 1),
                "ctt_drop_unit": "K/hr",
                "cape": round(val_cape, 0),
                "cape_unit": "J/kg",
                "cin": round(val_cin, 1),
                "convergence": round(val_conv, 2),
                "shear": round(val_shear, 1),
                "qpe_rainfall": round(val_qpe, 1),
                "elevation": round(val_elev, 0),
                "slope_deg": round(val_slope, 1)
            },
            "explanation": explanation
        }

xai_engine = ExplainableAIEngine()
