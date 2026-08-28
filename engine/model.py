"""
DisasterX AI Multi-Task Spatiotemporal Nowcasting Engine
Predicts with 2 to 6-hour actionable lead time:
1. Severe Thunderstorms (CAPE/CIN, Vertical Shear, Convergence)
2. Cloudbursts (IWV rapid variations, CTT drop rate, moisture concentration)
3. Flash Floods (Cloudburst magnitude fused with DEM Topography, slope & river basin accumulation)
"""

import numpy as np
from typing import Dict, Any, List
from engine.data_generator import data_engine

class SpatiotemporalMTLNowcaster:
    """
    Multi-Task Deep Learning architecture simulator:
    - Shared representation: Spatiotemporal cross-attention combining IWV, CTT, CAPE, DEM.
    - Specialized output heads:
        * Thunderstorm Head (P_ts)
        * Cloudburst Head (P_cb)
        * Flash Flood Head (P_ff)
    """
    def __init__(self):
        self.version = "DisasterX-MTL-v2.4"

    def predict(self, lead_time_hours: float = 2.0) -> Dict[str, Any]:
        """
        Executes unified multi-task forward pass across the atmospheric grid.
        Returns probability maps (0.0 to 1.0) and severe threshold breach flags.
        """
        grid_data = data_engine.generate_atmospheric_precursors(lead_time_hours)
        
        iwv = grid_data["iwv"]
        iwv_rate = grid_data["iwv_rate"]
        ctt = grid_data["ctt"]
        ctt_rate = grid_data["ctt_cooling_rate"]
        cape = grid_data["cape"]
        cin = grid_data["cin"]
        conv = grid_data["convergence"]
        shear = grid_data["shear"]
        dem = grid_data["dem"]
        slope = dem["slope"]
        drainage = dem["drainage"]
        lat_grid = grid_data["lat_grid"]
        lon_grid = grid_data["lon_grid"]

        # ==========================================
        # 1. SHARED ATMOSPHERIC EMBEDDING (Backbone)
        # ==========================================
        # Normalized precursor tensors
        norm_iwv = np.clip((iwv - 35.0) / 45.0, 0.0, 1.0)
        norm_iwv_rate = np.clip(iwv_rate / 15.0, 0.0, 1.0)
        norm_ctt_drop = np.clip(ctt_rate / 20.0, 0.0, 1.0)
        norm_cape = np.clip((cape - 1000.0) / 3000.0, 0.0, 1.0)
        norm_cin_erosion = np.clip((80.0 - cin) / 70.0, 0.0, 1.0)
        norm_conv = np.clip(conv / 12.0, 0.0, 1.0)
        norm_shear = np.clip((shear - 10.0) / 25.0, 0.0, 1.0)

        # Cross-modal latent representation (Atmospheric Convective Lift & Instability Index)
        convective_energy = (norm_cape * 0.5 + norm_cin_erosion * 0.3 + norm_conv * 0.2)
        moisture_forcing = (norm_iwv * 0.6 + norm_iwv_rate * 0.4)
        updraft_dynamics = (norm_ctt_drop * 0.6 + norm_shear * 0.4)

        # ==========================================
        # 2. MULTI-TASK PREDICTION HEADS
        # ==========================================

        # Head A: Severe Thunderstorm Risk
        # High CAPE + Low CIN + Strong Low-Level Convergence + Wind Shear
        thunderstorm_raw = (
            0.40 * convective_energy +
            0.30 * updraft_dynamics +
            0.20 * norm_conv +
            0.10 * norm_iwv
        )
        prob_thunderstorm = 1.0 / (1.0 + np.exp(-10.0 * (thunderstorm_raw - 0.45)))
        prob_thunderstorm = np.clip(prob_thunderstorm, 0.0, 1.0)

        # Head B: Localized Cloudburst Risk
        # Massive IWV accumulation + High IWV Surge Rate + Explosive CTT cooling
        cloudburst_raw = (
            0.45 * moisture_forcing +
            0.35 * norm_ctt_drop +
            0.20 * convective_energy
        )
        prob_cloudburst = 1.0 / (1.0 + np.exp(-12.0 * (cloudburst_raw - 0.52)))
        prob_cloudburst = np.clip(prob_cloudburst, 0.0, 1.0)

        # Head C: Flash Flood Risk
        # Atmospheric Cloudburst Intensity fused with Topographic DEM slope & catchment drainage
        topographic_vulnerability = 0.45 * (slope / 45.0) + 0.55 * drainage
        flashflood_raw = (
            0.55 * prob_cloudburst +
            0.35 * topographic_vulnerability +
            0.10 * (grid_data["qpe"] / 100.0)
        )
        prob_flashflood = 1.0 / (1.0 + np.exp(-11.0 * (flashflood_raw - 0.48)))
        prob_flashflood = np.clip(prob_flashflood, 0.0, 1.0)

        # Composite Hazard Risk Level
        composite_risk = np.maximum(prob_thunderstorm, np.maximum(prob_cloudburst, prob_flashflood))

        return {
            "lead_time": lead_time_hours,
            "region": data_engine.get_region_info(),
            "lat_grid": lat_grid,
            "lon_grid": lon_grid,
            "prob_thunderstorm": prob_thunderstorm,
            "prob_cloudburst": prob_cloudburst,
            "prob_flashflood": prob_flashflood,
            "composite_risk": composite_risk,
            "raw_inputs": grid_data
        }

nowcast_model = SpatiotemporalMTLNowcaster()
