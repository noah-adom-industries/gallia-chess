"""
Shared mutable state updated by the background capture thread
and read by the Flask routes.
"""

waveform: dict = {
    "ch1": {"time": [], "voltage": []},
    "ch2": {"time": [], "voltage": []},
    "ch3": {"time": [], "voltage": []},
    "ch4": {"time": [], "voltage": []},
    "status": "Initializing connection...",
}

settings: dict = {
    "acquisition":   "run",
    "timebase":      0.001,
    "time_position": 0.0,
    "channels": {
        "1": {"scale": 1.0, "enabled": True,  "offset": 0.0,
              "coupling": "DC", "probe": 1.0, "bwlimit": False, "invert": False},
        "2": {"scale": 1.0, "enabled": False, "offset": 0.0,
              "coupling": "DC", "probe": 1.0, "bwlimit": False, "invert": False},
        "3": {"scale": 1.0, "enabled": False, "offset": 0.0,
              "coupling": "DC", "probe": 1.0, "bwlimit": False, "invert": False},
        "4": {"scale": 1.0, "enabled": False, "offset": 0.0,
              "coupling": "DC", "probe": 1.0, "bwlimit": False, "invert": False},
    },
    "trigger": {
        "source": "CHANnel1",
        "slope":  "POSitive",
        "level":  0.0,
        "mode":   "AUTO",
    },
    "acquire": {
        "type":  "NORMal",
        "count": 8,
    },
}

measurements: list = []

timing: dict = {
    "fps":        0.0,
    "frame_ms":   0.0,
    "queue_ms":   0.0,
    "stop_ms":    0.0,
    "read_ms":    0.0,
    "measure_ms": 0.0,
    "run_ms":     0.0,
}
