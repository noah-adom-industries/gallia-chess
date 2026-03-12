"""
Driver for the Keysight DAQ970A / DAQ973A Data Acquisition System.

Supports plug-in modules (multiplexers, actuators, matrix switches, etc.).
Communication: VISA over TCP/IP socket (port 5025).

DAQM904A matrix channel addressing (slot 1 example):
  Row/Col numbering:  channel = slot_base + row*10 + col
  Row 1: 111 112 113 114 115 116 117 118
  Row 2: 121 122 123 124 125 126 127 128
  Row 3: 131 132 133 134 135 136 137 138
  Row 4: 141 142 143 144 145 146 147 148
  where slot_base = (slot-1)*100 + 100
"""


class KeysightDAQ970A:

    NAME               = "Keysight DAQ970A"
    DEFAULT_TIMEOUT_MS = 30_000

    CARD_INFO: dict[str, dict] = {
        "DAQM900A": {
            "name": "20-ch Solid-State Mux", "n_channels": 20,
            "card_type": "mux", "scan_rate": 450,
            "max_v": 120, "max_i": 0.02, "max_w": 2.4,
            "switch_tech": "FET", "closed_r": 1.0,
        },
        "DAQM901A": {
            "name": "20+2 ch Relay Mux", "n_channels": 22,
            "card_type": "mux", "scan_rate": 80,
            "max_v": 300, "max_i": 1.0, "max_w": 50,
            "switch_tech": "relay", "closed_r": 1.0,
        },
        "DAQM902A": {
            "name": "16-ch High-Speed Mux", "n_channels": 16,
            "card_type": "mux", "scan_rate": 250,
            "max_v": 300, "max_i": 0.05, "max_w": 2,
            "switch_tech": "reed", "closed_r": 0.2,
        },
        "DAQM903A": {
            "name": "20-ch Actuator", "n_channels": 20,
            "card_type": "actuator", "scan_rate": 70,
            "max_v": 300, "max_i": 1.0, "max_w": 50,
            "switch_tech": "relay", "closed_r": 1.0,
        },
        "DAQM904A": {
            "name": "4\u00d78 Two-Wire Matrix", "n_channels": 32,
            "card_type": "matrix", "scan_rate": 80,
            "max_v": 300, "max_i": 1.0, "max_w": 2,
            "switch_tech": "relay", "closed_r": 50.0,
            "rows": 4, "cols": 8,
        },
        "DAQM905A": {
            "name": "Dual 4-ch RF Mux 50\u03a9", "n_channels": 8,
            "card_type": "mux", "scan_rate": 120,
            "max_v": 42, "max_i": 0.7, "max_w": 50,
            "switch_tech": "relay", "closed_r": 0.5,
        },
        "DAQM907A": {
            "name": "Multifunction", "n_channels": 0,
            "card_type": "multifunction",
        },
        "DAQM908A": {
            "name": "40-ch Single-Ended Mux", "n_channels": 40,
            "card_type": "mux", "scan_rate": 80,
            "max_v": 300, "max_i": 1.0, "max_w": 50,
            "switch_tech": "relay", "closed_r": 1.0,
        },
        "DAQM909A": {
            "name": "4-ch Digitizer", "n_channels": 4,
            "card_type": "digitizer",
        },
        "DAQM910A": {
            "name": "20-ch Low-V Mux", "n_channels": 20,
            "card_type": "mux", "scan_rate": 60,
            "max_v": 40, "max_i": 1.0, "max_w": 50,
            "switch_tech": "relay", "closed_r": 1.0,
        },
    }

    MEAS_TYPES: dict[str, str] = {
        "VOLT:DC":  "DC Voltage",
        "VOLT:AC":  "AC Voltage",
        "RES":      "Resistance (2W)",
        "FRES":     "Resistance (4W)",
        "TEMP:TC":  "Temperature (TC)",
        "TEMP:RTD": "Temperature (RTD)",
        "FREQ":     "Frequency",
        "DIOD":     "Diode",
        "CURR:DC":  "DC Current",
        "CURR:AC":  "AC Current",
    }

    # ── Connection setup ──────────────────────────────────────────────────

    def setup(self, resource) -> None:
        resource.read_termination  = "\n"
        resource.write_termination = "\n"
        resource.timeout           = self.DEFAULT_TIMEOUT_MS
        resource.clear()
        resource.write(":FORM:READ:CHAN OFF")
        resource.write(":FORM:READ:UNIT OFF")
        resource.write(":FORM:READ:ALAR OFF")
        resource.write(":FORM:READ:TIME OFF")
        resource.write(":TRIG:SOUR IMM")
        resource.write(":TRIG:COUN 1")

    # ── Module detection ──────────────────────────────────────────────────

    def detect_modules(self, resource) -> dict[int, str]:
        modules: dict[int, str] = {}
        for slot in (1, 2, 3):
            try:
                ctype = resource.query(f":SYST:CTYP? {slot}").strip()
                if not ctype or ctype == "0":
                    continue
                parts = ctype.split(",")
                model = parts[1].strip() if len(parts) > 1 else parts[0].strip()
                skip = (not model or model == "0"
                        or "EMPTY" in model.upper()
                        or "NONE"  in model.upper())
                if not skip:
                    modules[slot] = ctype
            except Exception:
                pass
        return modules

    def parse_module_info(self, slot: int, ctype_str: str) -> dict:
        parts = ctype_str.split(",")
        model = parts[1].strip() if len(parts) > 1 else parts[0].strip()
        info  = self.CARD_INFO.get(model, {"name": model or "Unknown", "n_channels": 0})
        n     = info["n_channels"]

        card_type = info.get("card_type", "mux")

        # Matrix cards use row/col addressing: ch = slot_base + row*10 + col
        if card_type == "matrix":
            rows = info.get("rows", 4)
            cols = info.get("cols", 8)
            slot_base = (slot - 1) * 100 + 100
            ch_first = slot_base + 11          # row1, col1
            ch_last  = slot_base + rows * 10 + cols   # row4, col8
            ch_str   = f"{ch_first}-{ch_last}"
        else:
            base = (slot - 1) * 100 + 101
            ch_first = base          if n > 0 else None
            ch_last  = base + n - 1  if n > 0 else None
            ch_str   = f"{base}-{base + n - 1}" if n > 0 else ""

        result = {
            "slot":       slot,
            "model":      model,
            "name":       info["name"],
            "n_channels": n,
            "card_type":  card_type,
            "ch_first":   ch_first,
            "ch_last":    ch_last,
            "ch_str":     ch_str,
        }

        for key in ("rows", "cols", "max_v", "max_i", "max_w",
                     "scan_rate", "switch_tech", "closed_r"):
            if key in info:
                result[key] = info[key]

        return result

    # ── Scan / measurement ────────────────────────────────────────────────

    def configure_channels(self, resource, channels: list[int],
                           mtype: str = "VOLT:DC") -> None:
        ch_str = ",".join(str(c) for c in channels)
        if mtype == "TEMP:TC":
            resource.write(f":CONF:TEMP TC,J,DEF,(@{ch_str})")
        elif mtype == "TEMP:RTD":
            resource.write(f":CONF:TEMP RTD,85,DEF,(@{ch_str})")
        elif mtype == "DIOD":
            resource.write(f":CONF:DIOD (@{ch_str})")
        else:
            resource.write(f":CONF:{mtype} AUTO,DEF,(@{ch_str})")
        resource.write(f":ROUT:SCAN:CREA (@{ch_str})")

    def set_nplc(self, resource, nplc: float, channels: list[int],
                 mtype: str = "VOLT:DC") -> None:
        ch_str  = ",".join(str(c) for c in channels)
        parts   = mtype.split(":")
        nplc_cmd = f":SENS:{':'.join(parts)}:NPLC {nplc:.4f},(@{ch_str})"
        try:
            resource.write(nplc_cmd)
        except Exception:
            pass

    def scan(self, resource) -> list[float]:
        resource.write(":INIT")
        resource.query("*OPC?")
        raw = resource.query(":FETC?")
        return [float(v) for v in raw.strip().split(",")]

    def abort(self, resource) -> None:
        resource.write(":ABOR")

    def reset(self, resource) -> None:
        resource.write("*RST")
        resource.query("*OPC?")

    # ── Relay / matrix control ────────────────────────────────────────────

    def close_relay(self, resource, channel: int) -> None:
        resource.write(f":ROUT:CLOS (@{channel})")

    def open_relay(self, resource, channel: int) -> None:
        resource.write(f":ROUT:OPEN (@{channel})")

    @staticmethod
    def matrix_channels(slot: int, rows: int = 4, cols: int = 8) -> list[int]:
        """Return all valid channel numbers for a matrix card in the given slot."""
        slot_base = (slot - 1) * 100 + 100
        channels = []
        for r in range(1, rows + 1):
            for c in range(1, cols + 1):
                channels.append(slot_base + r * 10 + c)
        return channels

    def open_all_relays(self, resource, slot: int, n_channels: int = 20,
                        card_type: str = "actuator",
                        rows: int = 4, cols: int = 8) -> None:
        if card_type == "matrix":
            ch_list = self.matrix_channels(slot, rows, cols)
            ch_str = ",".join(str(c) for c in ch_list)
            resource.write(f":ROUT:OPEN (@{ch_str})")
        else:
            base = (slot - 1) * 100 + 101
            last = base + n_channels - 1
            resource.write(f":ROUT:OPEN (@{base}:{last})")

    def query_relay_states(self, resource, slot: int, n_channels: int = 20,
                           card_type: str = "actuator",
                           rows: int = 4, cols: int = 8) -> list[int]:
        try:
            if card_type == "matrix":
                ch_list = self.matrix_channels(slot, rows, cols)
                ch_str = ",".join(str(c) for c in ch_list)
                raw = resource.query(f":ROUT:CLOS? (@{ch_str})").strip()
                bits = [int(float(v)) for v in raw.split(",")]
                return [ch for ch, b in zip(ch_list, bits) if b]
            else:
                base = (slot - 1) * 100 + 101
                last = base + n_channels - 1
                raw = resource.query(f":ROUT:CLOS? (@{base}:{last})").strip()
                bits = [int(float(v)) for v in raw.split(",")]
                return [base + i for i, b in enumerate(bits) if b]
        except Exception:
            return []
