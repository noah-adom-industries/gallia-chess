"""
Background capture thread.
"""

import json
import queue
import threading
import time

import pyvisa

from . import state
from drivers import get_driver
import config


_queue: list[tuple[str, dict]] = []
_queue_lock = threading.Lock()

_sse_clients: list[queue.Queue] = []
_sse_lock = threading.Lock()

_preamble_cache: dict[str, dict] = {}
_waveform_source: list[str | None] = [None]

_PREAMBLE_DEPS: frozenset[str] = frozenset({
    "set_channel_scale", "set_channel_offset", "set_channel_probe",
    "set_channel_display", "set_timebase", "set_time_position",
})


def register_sse_client() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=2)
    with _sse_lock:
        _sse_clients.append(q)
    return q


def unregister_sse_client(q: queue.Queue) -> None:
    with _sse_lock:
        try:
            _sse_clients.remove(q)
        except ValueError:
            pass


def _push_sse() -> None:
    payload = json.dumps({
        "waveform":     state.waveform,
        "settings":     state.settings,
        "measurements": state.measurements,
        "timing":       state.timing,
    })
    msg = f"data: {payload}\n\n"
    with _sse_lock:
        for q in list(_sse_clients):
            try:
                q.put_nowait(msg)
            except queue.Full:
                pass


def queue_command(method: str, **kwargs) -> None:
    with _queue_lock:
        _queue.append((method, kwargs))


def _refresh_preambles(driver, resource, channels: list[str]) -> None:
    for ch in channels:
        try:
            _preamble_cache[ch] = driver.read_preamble(resource, ch)
            _waveform_source[0] = ch
        except Exception:
            pass


def _query_measurements(driver, resource) -> None:
    for m in state.measurements:
        try:
            m["value"] = driver.get_measurement(resource, m["type"], m["source"])
        except Exception:
            m["value"] = None


def _record_timing(t0, t1, t2, t3, t4, t5, alpha, last_t) -> None:
    ms = 1000.0
    frame_s = t0 - last_t
    instant_fps = 1.0 / frame_s if frame_s > 0 else 0.0
    prev_fps    = state.timing.get("fps", 0.0)
    smoothed    = alpha * instant_fps + (1.0 - alpha) * prev_fps if prev_fps else instant_fps

    state.timing["fps"]        = round(smoothed, 1)
    state.timing["frame_ms"]   = round((t5 - t0) * ms, 2)
    state.timing["queue_ms"]   = round((t1 - t0) * ms, 2)
    state.timing["stop_ms"]    = round((t2 - t1) * ms, 2)
    state.timing["read_ms"]    = round((t3 - t2) * ms, 2)
    state.timing["measure_ms"] = round((t4 - t3) * ms, 2)
    state.timing["run_ms"]     = round((t5 - t4) * ms, 2)


def _read_channels(driver, resource, enabled: list[str]) -> None:
    for ch in enabled:
        if _waveform_source[0] != ch:
            driver.set_waveform_source(resource, ch)
            _waveform_source[0] = ch

        raw      = driver.read_waveform_data(resource)
        preamble = _preamble_cache.get(ch)
        if preamble:
            t, v = driver.scale_waveform(raw, preamble)
        else:
            t, v = driver.read_waveform(resource)

        state.waveform[f"ch{ch}"]["time"]    = t.tolist()
        state.waveform[f"ch{ch}"]["voltage"] = v.tolist()

    all_chs = [str(n) for n in range(1, driver.N_CHANNELS + 1)]
    for ch in all_chs:
        if ch not in enabled:
            state.waveform[f"ch{ch}"]["time"]    = []
            state.waveform[f"ch{ch}"]["voltage"] = []


def _capture_loop() -> None:
    driver = get_driver(config.DRIVER_NAME)
    rm     = pyvisa.ResourceManager()

    try:
        resource = rm.open_resource(config.VISA_ADDRESS)
        driver.setup(resource)

        initial = driver.read_settings(resource)
        state.settings.update(initial)
        driver.run_acquisition(resource)
        state.waveform["status"] = "Connected"

        _refresh_preambles(driver, resource,
                           [str(n) for n in range(1, driver.N_CHANNELS + 1)])

        _fps_alpha = 0.15
        _last_t   = time.perf_counter()

        while True:
            t0 = time.perf_counter()

            with _queue_lock:
                cmds = list(_queue)
                _queue.clear()
            for method, kwargs in cmds:
                getattr(driver, method)(resource, **kwargs)

            if cmds:
                need_refresh: set[str] = set()
                all_ch_strs = [str(n) for n in range(1, driver.N_CHANNELS + 1)]
                for method, kwargs in cmds:
                    if method in {"set_timebase", "set_time_position"}:
                        need_refresh.update(all_ch_strs)
                    elif method in _PREAMBLE_DEPS:
                        ch = str(kwargs.get("channel", ""))
                        if ch:
                            need_refresh.add(ch)
                if need_refresh:
                    _refresh_preambles(driver, resource, list(need_refresh))

            t1 = time.perf_counter()

            mode = state.settings.get("acquisition", "run")

            if mode == "stop":
                time.sleep(0.05)
                continue

            enabled = [
                ch for ch, cfg in state.settings["channels"].items()
                if cfg["enabled"]
            ]
            if not enabled:
                enabled = ["1"]

            if mode == "single":
                driver.single_acquisition(resource)
                t2 = time.perf_counter()
                _read_channels(driver, resource, enabled)
                t3 = time.perf_counter()
                _query_measurements(driver, resource)
                t4 = time.perf_counter()
                state.waveform["status"] = "Stopped"
                state.settings["acquisition"] = "stop"
                _record_timing(t0, t1, t2, t3, t4, t4, _fps_alpha, _last_t)
                _last_t = t0
                _push_sse()
                continue

            t2 = t1
            _read_channels(driver, resource, enabled)
            t3 = time.perf_counter()
            _query_measurements(driver, resource)
            t4 = time.perf_counter()
            t5 = t4
            state.waveform["status"] = "Live"
            _record_timing(t0, t1, t2, t3, t4, t5, _fps_alpha, _last_t)
            _last_t = t0
            _push_sse()

    except Exception as exc:
        state.waveform["status"] = f"Error: {exc}"
        print(f"Scope Thread Error: {exc}")
    finally:
        try:
            driver.resume(resource)
            resource.close()
        except Exception:
            pass


def start() -> None:
    t = threading.Thread(target=_capture_loop, daemon=True)
    t.start()
