"""
Driver for the Keysight InfiniiVision DSOX1204G (4-channel, 70 MHz DSO).
"""

import numpy as np

from .base import ScopeDriver


class KeysightDSOX1204G(ScopeDriver):

    NAME       = "Keysight DSOX1204G"
    N_CHANNELS = 4

    CHANNEL_COLORS = {
        "1": "#FFD700",
        "2": "#00E5FF",
        "3": "#FF00FF",
        "4": "#00FF88",
    }

    TIMEBASE_OPTIONS = [
        (1e-9,  "1 ns/div"),  (2e-9,  "2 ns/div"),  (5e-9,  "5 ns/div"),
        (1e-8, "10 ns/div"),  (2e-8, "20 ns/div"),  (5e-8, "50 ns/div"),
        (1e-7,"100 ns/div"),  (2e-7,"200 ns/div"),  (5e-7,"500 ns/div"),
        (1e-6,  "1 us/div"),  (2e-6,  "2 us/div"),  (5e-6,  "5 us/div"),
        (1e-5, "10 us/div"),  (2e-5, "20 us/div"),  (5e-5, "50 us/div"),
        (1e-4,"100 us/div"),  (2e-4,"200 us/div"),  (5e-4,"500 us/div"),
        (1e-3,  "1 ms/div"),  (2e-3,  "2 ms/div"),  (5e-3,  "5 ms/div"),
        (1e-2, "10 ms/div"),  (2e-2, "20 ms/div"),  (5e-2, "50 ms/div"),
        (0.1, "100 ms/div"),  (0.2, "200 ms/div"),  (0.5, "500 ms/div"),
        (1,     "1 s/div"),   (2,    "2 s/div"),    (5,    "5 s/div"),
        (10,   "10 s/div"),   (20,  "20 s/div"),    (50,  "50 s/div"),
    ]

    VSCALE_OPTIONS = [
        (0.001,  "1 mV/div"), (0.002,  "2 mV/div"), (0.005,  "5 mV/div"),
        (0.01,  "10 mV/div"), (0.02,  "20 mV/div"), (0.05,  "50 mV/div"),
        (0.1,  "100 mV/div"), (0.2,  "200 mV/div"), (0.5,  "500 mV/div"),
        (1,      "1 V/div"),  (2,     "2 V/div"),   (5,     "5 V/div"),
        (10,    "10 V/div"),  (20,   "20 V/div"),
    ]

    def setup(self, resource) -> None:
        resource.read_termination  = "\n"
        resource.write_termination = "\n"
        resource.timeout = 15000
        resource.clear()
        resource.write(":WAVeform:FORMat WORD")
        resource.write(":WAVeform:BYTeorder LSBFirst")
        resource.write(":WAVeform:UNSigned 1")
        resource.write(":WAVeform:POINts:MODE NORMal")
        resource.write(":WAVeform:POINts 500")

    def read_settings(self, resource) -> dict:
        settings = {
            "acquisition":   "run",
            "timebase":      0.001,
            "time_position": 0.0,
            "channels": {
                str(ch): {
                    "scale": 1.0, "enabled": ch == 1, "offset": 0.0,
                    "coupling": "DC", "probe": 1.0, "bwlimit": False, "invert": False,
                }
                for ch in range(1, self.N_CHANNELS + 1)
            },
            "trigger": {"source": "CHANnel1", "slope": "POSitive",
                        "level": 0.0, "mode": "AUTO"},
            "acquire": {"type": "NORMal", "count": 8},
        }
        try:
            settings["timebase"] = float(resource.query(":TIMebase:SCALe?"))
        except Exception:
            pass
        try:
            settings["time_position"] = float(resource.query(":TIMebase:POSition?"))
        except Exception:
            pass
        for ch in range(1, self.N_CHANNELS + 1):
            try:
                s = settings["channels"][str(ch)]
                s["scale"]    = float(resource.query(f":CHANnel{ch}:SCALe?"))
                disp          = resource.query(f":CHANnel{ch}:DISPlay?").strip()
                s["enabled"]  = disp in ("1", "ON")
                s["offset"]   = float(resource.query(f":CHANnel{ch}:OFFSet?"))
                s["coupling"] = resource.query(f":CHANnel{ch}:COUPling?").strip()
                s["probe"]    = float(resource.query(f":CHANnel{ch}:PROBe?"))
                bwl           = resource.query(f":CHANnel{ch}:BWLimit?").strip()
                s["bwlimit"]  = bwl in ("1", "ON")
                inv           = resource.query(f":CHANnel{ch}:INVert?").strip()
                s["invert"]   = inv in ("1", "ON")
            except Exception:
                pass
        try:
            settings["trigger"]["source"] = resource.query(":TRIGger:SOURce?").strip()
            settings["trigger"]["slope"]  = resource.query(":TRIGger:SLOPe?").strip()
            settings["trigger"]["level"]  = float(resource.query(":TRIGger:LEVel?"))
            settings["trigger"]["mode"]   = resource.query(":TRIGger:SWEep?").strip()
        except Exception:
            pass
        try:
            settings["acquire"]["type"]  = resource.query(":ACQuire:TYPE?").strip()
            settings["acquire"]["count"] = int(float(resource.query(":ACQuire:COUNt?")))
        except Exception:
            pass
        return settings

    def digitize(self, resource, channels: list) -> None:
        arg = ",".join(f"CHANnel{ch}" for ch in channels)
        resource.write(f":DIGitize {arg}")

    def set_waveform_source(self, resource, channel: str) -> None:
        resource.write(f":WAVeform:SOURce CHANnel{channel}")

    def read_waveform(self, resource) -> tuple:
        preamble = resource.query(":WAVeform:PREamble?").split(",")
        x_inc  = float(preamble[4])
        x_orig = float(preamble[5])
        x_ref  = float(preamble[6])
        y_inc  = float(preamble[7])
        y_orig = float(preamble[8])
        y_ref  = float(preamble[9])
        raw = resource.query_binary_values(
            ":WAVeform:DATA?",
            datatype="H", is_big_endian=False, container=np.array,
        )
        t = (np.arange(len(raw)) - x_ref) * x_inc + x_orig
        v = (raw - y_ref) * y_inc + y_orig
        return t, v

    def read_preamble(self, resource, channel: str) -> dict:
        resource.write(f":WAVeform:SOURce CHANnel{channel}")
        p = resource.query(":WAVeform:PREamble?").split(",")
        return {
            "x_inc": float(p[4]), "x_orig": float(p[5]), "x_ref": float(p[6]),
            "y_inc": float(p[7]), "y_orig": float(p[8]), "y_ref": float(p[9]),
        }

    def read_waveform_data(self, resource) -> np.ndarray:
        return resource.query_binary_values(
            ":WAVeform:DATA?",
            datatype="H", is_big_endian=False, container=np.array,
        )

    def resume(self, resource) -> None:
        resource.write(":RUN")

    def stop_acquisition(self, resource) -> None:
        resource.write(":STOP")

    def run_acquisition(self, resource) -> None:
        resource.write(":RUN")

    def single_acquisition(self, resource) -> None:
        resource.write(":SINGle")
        resource.query("*OPC?")

    def set_timebase(self, resource, value: float) -> None:
        resource.write(f":TIMebase:SCALe {value:.6e}")

    def set_time_position(self, resource, value: float) -> None:
        resource.write(f":TIMebase:POSition {value:.6e}")

    def set_channel_scale(self, resource, channel: str, scale: float) -> None:
        resource.write(f":CHANnel{channel}:SCALe {scale:.4e}")

    def set_channel_display(self, resource, channel: str, enabled: bool) -> None:
        resource.write(f":CHANnel{channel}:DISPlay {'ON' if enabled else 'OFF'}")

    def set_channel_offset(self, resource, channel: str, offset: float) -> None:
        resource.write(f":CHANnel{channel}:OFFSet {offset:.4f}")

    def set_trigger_source(self, resource, source: str) -> None:
        resource.write(f":TRIGger:SOURce {source}")

    def set_trigger_slope(self, resource, slope: str) -> None:
        resource.write(f":TRIGger:SLOPe {slope}")

    def set_trigger_level(self, resource, level: float) -> None:
        resource.write(f":TRIGger:LEVel {level:.4f}")

    def set_trigger_mode(self, resource, mode: str) -> None:
        resource.write(f":TRIGger:SWEep {mode}")

    def set_channel_coupling(self, resource, channel: str, coupling: str) -> None:
        resource.write(f":CHANnel{channel}:COUPling {coupling}")

    def set_channel_probe(self, resource, channel: str, ratio: float) -> None:
        resource.write(f":CHANnel{channel}:PROBe {ratio:.4g}")

    def set_channel_bwlimit(self, resource, channel: str, bwlimit: bool) -> None:
        resource.write(f":CHANnel{channel}:BWLimit {'ON' if bwlimit else 'OFF'}")

    def set_channel_invert(self, resource, channel: str, invert: bool) -> None:
        resource.write(f":CHANnel{channel}:INVert {'ON' if invert else 'OFF'}")

    def set_acquire_type(self, resource, acq_type: str) -> None:
        resource.write(f":ACQuire:TYPE {acq_type}")

    def set_acquire_count(self, resource, count: int) -> None:
        resource.write(f":ACQuire:COUNt {count}")

    def get_measurement(self, resource, mtype: str, source: str) -> float | None:
        if mtype in ("VRMS", "VAVerage"):
            raw = resource.query(f":MEASure:{mtype}? DISPlay,{source}")
        else:
            raw = resource.query(f":MEASure:{mtype}? {source}")
        val = float(raw)
        return None if val >= 9e37 else val
