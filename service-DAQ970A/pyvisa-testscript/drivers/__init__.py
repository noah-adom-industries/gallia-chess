"""
Driver registry.

Scope drivers
─────────────
  To add a new oscilloscope:
    1. Create drivers/<name>.py  (subclass ScopeDriver)
    2. Import it here and add it to SCOPE_REGISTRY
    3. Set DRIVER_NAME = "<name>" in config.py

Instrument drivers (runtime-added via instrument manager)
─────────────────────────────────────────────────────────
  To add a new instrument type:
    1. Create drivers/<name>.py
    2. Import it here and add it to INSTRUMENT_REGISTRY
    3. Add an IDN pattern to IDN_PATTERNS
"""

from .keysight_dsox1204g import KeysightDSOX1204G
from .keysight_daq970a   import KeysightDAQ970A
from .base import ScopeDriver  # re-export for type hints elsewhere

# ── Scope registry (keyed by DRIVER_NAME in config.py) ───────────────────────

SCOPE_REGISTRY: dict[str, type[ScopeDriver]] = {
    "keysight_dsox1204g": KeysightDSOX1204G,
}

# ── Generic instrument registry (keyed by driver_key) ────────────────────────

INSTRUMENT_REGISTRY: dict[str, type] = {
    "keysight_dsox1204g": KeysightDSOX1204G,
    "keysight_daq970a":   KeysightDAQ970A,
}

# ── IDN auto-detection patterns ───────────────────────────────────────────────
# Each entry: (substring_to_match_in_IDN, instrument_type, driver_key)
# First match wins.

IDN_PATTERNS: list[tuple[str, str, str]] = [
    ("DAQ970A",   "daq",   "keysight_daq970a"),
    ("DAQ973A",   "daq",   "keysight_daq970a"),   # compatible firmware
    ("DSOX1204G", "scope", "keysight_dsox1204g"),
    ("DSOX1000",  "scope", "keysight_dsox1204g"),
]


# ── Public helpers ────────────────────────────────────────────────────────────

def get_driver(name: str) -> ScopeDriver:
    """Instantiate and return the scope driver registered under *name*.

    Kept for backwards compatibility — scope/controller.py uses this.
    """
    cls = SCOPE_REGISTRY.get(name)
    if cls is None:
        available = ", ".join(SCOPE_REGISTRY)
        raise ValueError(f"Unknown driver '{name}'. Available: {available}")
    return cls()


def detect_driver_from_idn(idn: str) -> tuple[str, str] | None:
    """Match a *IDN? response to (instrument_type, driver_key). Returns None if unknown."""
    for pattern, itype, driver_key in IDN_PATTERNS:
        if pattern in idn:
            return itype, driver_key
    return None


def build_instrument_driver(driver_key: str):
    """Instantiate an instrument driver by key. Returns None if unknown."""
    cls = INSTRUMENT_REGISTRY.get(driver_key)
    return cls() if cls else None
