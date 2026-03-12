# ── Instrument connection ─────────────────────────────────────────────────────
IP_ADDRESS   = "10.0.3.83"
VISA_ADDRESS = f"TCPIP0::{IP_ADDRESS}::5025::SOCKET"

# ── Driver selection ──────────────────────────────────────────────────────────
DRIVER_NAME = "keysight_daq970a"

# ── Startup instruments ───────────────────────────────────────────────────────
STARTUP_INSTRUMENTS: list[dict] = [
    {"ip": "10.0.3.83", "port": 5025},   # Keysight DAQ970A
]
