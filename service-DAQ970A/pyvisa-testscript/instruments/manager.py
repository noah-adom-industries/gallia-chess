"""
Instrument manager.

Handles connecting to, identifying, and running background acquisition
loops for instruments added at runtime (DAQ units, secondary scopes, etc.).
"""

import json
import queue
import threading
import time
from typing import Any

import pyvisa


_UNITS: dict[str, str] = {
    "VOLT:DC":  "VDC",
    "VOLT:AC":  "VAC",
    "RES":      "\u03a9",
    "FRES":     "\u03a9",
    "TEMP:TC":  "\u00b0C",
    "TEMP:RTD": "\u00b0C",
    "FREQ":     "Hz",
    "DIOD":     "V",
    "CURR:DC":  "ADC",
    "CURR:AC":  "AAC",
}


def _unit_for(mtype: str) -> str:
    return _UNITS.get(mtype, "")


def parse_channels(s: str) -> list[int]:
    channels: list[int] = []
    for part in s.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            channels.extend(range(int(lo.strip()), int(hi.strip()) + 1))
        elif part:
            channels.append(int(part))
    return sorted(set(channels))


class InstrumentHandle:

    def __init__(self, ip, port, idn, driver_key, instrument_type, driver, resource):
        self.ip              = ip
        self.port            = port
        self.idn             = idn
        self.driver_key      = driver_key
        self.instrument_type = instrument_type
        self.driver          = driver
        self.resource        = resource

        self.state: dict = {
            "status":       "Connected",
            "idn":          idn,
            "scan_enabled": False,
            "channels":     [],
            "mtype":        "VOLT:DC",
            "interval":     1.0,
            "readings":     [],
            "scan_count":   0,
        }

        self.modules: list[dict] = []

        self._sse_clients: list[queue.Queue] = []
        self._sse_lock  = threading.Lock()
        self._stop      = threading.Event()
        self.thread: threading.Thread | None = None

    def register_sse_client(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=4)
        with self._sse_lock:
            self._sse_clients.append(q)
        return q

    def unregister_sse_client(self, q: queue.Queue) -> None:
        with self._sse_lock:
            try:
                self._sse_clients.remove(q)
            except ValueError:
                pass

    def push(self) -> None:
        msg = f"data: {json.dumps(self.state)}\n\n"
        with self._sse_lock:
            for q in list(self._sse_clients):
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    pass

    def stop(self) -> None:
        self._stop.set()

    def info(self) -> dict:
        return {
            "ip":              self.ip,
            "port":            self.port,
            "idn":             self.idn,
            "driver_key":      self.driver_key,
            "instrument_type": self.instrument_type,
            "status":          self.state.get("status", "Unknown"),
            "modules":         self.modules,
        }


def _query_relay_states(handle: InstrumentHandle) -> None:
    if not hasattr(handle.driver, "query_relay_states"):
        return
    closed_relays = {}
    for mod in handle.modules:
        ct = mod.get("card_type", "")
        if ct in ("actuator", "matrix"):
            try:
                closed = handle.driver.query_relay_states(
                    handle.resource,
                    mod["slot"],
                    n_channels=mod.get("n_channels", 20),
                    card_type=ct,
                    rows=mod.get("rows", 4),
                    cols=mod.get("cols", 8),
                )
                closed_relays[str(mod["slot"])] = closed
            except Exception:
                pass
    handle.state["closed_relays"] = closed_relays


def _daq_loop(handle: InstrumentHandle) -> None:
    driver   = handle.driver
    resource = handle.resource

    _query_relay_states(handle)

    while not handle._stop.is_set():
        if not handle.state.get("scan_enabled", False):
            _query_relay_states(handle)
            time.sleep(0.25)
            continue

        channels = handle.state.get("channels", [])
        mtype    = handle.state.get("mtype", "VOLT:DC")
        interval = max(0.1, float(handle.state.get("interval", 1.0)))

        if not channels:
            _query_relay_states(handle)
            time.sleep(0.1)
            continue

        try:
            values = driver.scan(resource)
            unit   = _unit_for(mtype)
            handle.state["readings"] = [
                {"channel": ch, "value": val, "unit": unit}
                for ch, val in zip(channels, values)
            ]
            handle.state["scan_count"] = handle.state.get("scan_count", 0) + 1
            handle.state["status"]     = "Scanning"
        except Exception as exc:
            handle.state["status"] = f"Error: {exc}"
            print(f"DAQ loop error ({handle.ip}): {exc}")

        _query_relay_states(handle)

        handle.push()

        deadline = time.perf_counter() + interval
        while time.perf_counter() < deadline and not handle._stop.is_set():
            time.sleep(0.05)


class InstrumentManager:

    def __init__(self) -> None:
        self._handles: dict[str, InstrumentHandle] = {}
        self._lock    = threading.Lock()

    def add(self, ip: str, port: int = 5025) -> dict:
        with self._lock:
            if ip in self._handles:
                return {"ok": False, "error": f"{ip} is already connected"}

        visa_addr = f"TCPIP0::{ip}::{port}::SOCKET"
        try:
            rm       = pyvisa.ResourceManager()
            resource = rm.open_resource(visa_addr)
            resource.read_termination  = "\n"
            resource.write_termination = "\n"
            resource.timeout           = 5000
            try:
                resource.clear()
            except Exception:
                pass
            try:
                idn = resource.query("*IDN?").strip()
            except UnicodeDecodeError:
                resource.close()
                return {
                    "ok": False,
                    "error": (
                        f"Non-ASCII response on port {port} — "
                        "is this the correct SCPI port? "
                        "(DAQ970A / oscilloscopes typically use port 5025)"
                    ),
                }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

        from drivers import detect_driver_from_idn, build_instrument_driver
        result = detect_driver_from_idn(idn)
        if result is None:
            resource.close()
            return {"ok": False, "error": f"Unrecognised instrument: {idn}"}

        instrument_type, driver_key = result
        driver = build_instrument_driver(driver_key)
        if driver is None:
            resource.close()
            return {"ok": False, "error": f"No driver found for '{driver_key}'"}

        try:
            driver.setup(resource)
        except Exception as exc:
            resource.close()
            return {"ok": False, "error": f"Driver setup failed: {exc}"}

        modules: list[dict] = []
        if hasattr(driver, "detect_modules") and hasattr(driver, "parse_module_info"):
            try:
                raw = driver.detect_modules(resource)
                for slot, ctype_str in sorted(raw.items()):
                    modules.append(driver.parse_module_info(slot, ctype_str))
            except Exception as exc:
                print(f"Module detection failed ({ip}): {exc}")

        handle = InstrumentHandle(ip, port, idn, driver_key, instrument_type,
                                  driver, resource)
        handle.modules = modules

        if instrument_type == "daq":
            t = threading.Thread(target=_daq_loop, args=(handle,), daemon=True)
            handle.thread = t
            t.start()

        with self._lock:
            self._handles[ip] = handle

        return {"ok": True, "info": handle.info()}

    def remove(self, ip: str) -> dict:
        with self._lock:
            handle = self._handles.pop(ip, None)
        if not handle:
            return {"ok": False, "error": "Instrument not found"}
        handle.stop()
        try:
            handle.resource.close()
        except Exception:
            pass
        return {"ok": True}

    def get(self, ip: str) -> InstrumentHandle | None:
        return self._handles.get(ip)

    def list_all(self) -> list[dict]:
        return [h.info() for h in self._handles.values()]
