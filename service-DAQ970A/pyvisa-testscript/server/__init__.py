"""
Flask application factory — DAQ970A only.
"""

import threading
from flask import Flask
from flask_cors import CORS

from instruments.manager import InstrumentManager
import config

app = Flask(__name__)
CORS(app)

instrument_manager = InstrumentManager()


@app.after_request
def _cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
    return response


def _auto_connect():
    """Connect instruments listed in config.STARTUP_INSTRUMENTS on boot."""
    import time
    time.sleep(1)
    for entry in getattr(config, "STARTUP_INSTRUMENTS", []):
        try:
            instrument_manager.add(entry["ip"], entry.get("port", 5025))
            print(f"Auto-connected {entry['ip']}:{entry.get('port', 5025)}")
        except Exception as exc:
            print(f"Auto-connect failed for {entry['ip']}: {exc}")


threading.Thread(target=_auto_connect, daemon=True).start()

from server import routes  # noqa: E402, F401
