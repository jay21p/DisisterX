"""
DisasterX Prototype Launcher
Starts FastAPI backend server and serves clean minimal nowcasting dashboard.
"""

import sys
import os
import uvicorn

# Ensure utf-8 output encoding on Windows consoles
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

if __name__ == "__main__":
    print("=" * 65)
    print(">> Starting DisasterX: AI-Driven Hyper-Local Nowcasting System")
    print("=" * 65)
    print("-> Telemetry Feeds: INSAT-3D/3DR (MOSDAC), IMDAA, CartoDEM")
    print("-> Spatiotemporal Multi-Task Engine: Thunderstorms, Cloudbursts, Flash Floods")
    print("-> Dashboard URL: http://127.0.0.1:8000")
    print("-> Swagger API Docs: http://127.0.0.1:8000/docs")
    print("=" * 65)

    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, reload=True)
