"""
Flask routes — DAQ970A instrument control only.
"""

import json
import os
import queue

from flask import request, jsonify, render_template, Response

from server import app, instrument_manager


# ── Helpers ──────────────────────────────────────────────────────────────────

def _proxy_base():
    proxy = os.environ.get("VSCODE_PROXY_URI", "")
    if proxy:
        return proxy.replace("{{port}}", "5000")
    return ""


def _find_module(handle, slot):
    for mod in handle.modules:
        if mod["slot"] == slot:
            return mod
    return {}


# ── Pages ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", api_base=_proxy_base())


@app.route("/viewer")
def viewer():
    return render_template("index.html", api_base=_proxy_base())


# ── Health ───────────────────────────────────────────────────────────────────

@app.route("/ping")
def ping():
    return "pong"


# ── Instrument CRUD ─────────────────────────────────────────────────────────

@app.route("/instruments", methods=["GET"])
def list_instruments():
    return jsonify({"instruments": instrument_manager.list_all()})


@app.route("/instruments", methods=["POST"])
def add_instrument():
    body = request.get_json(force=True)
    ip = body.get("ip", "").strip()
    port = int(body.get("port", 5025))
    if not ip:
        return jsonify({"ok": False, "error": "IP required"}), 400
    try:
        info = instrument_manager.add(ip, port)
        return jsonify({"ok": True, "info": info})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/instruments/<path:ip>", methods=["DELETE"])
def remove_instrument(ip):
    instrument_manager.remove(ip)
    return jsonify({"ok": True})


# ── Instrument data ─────────────────────────────────────────────────────────

@app.route("/instruments/<path:ip>/data")
def instrument_data(ip):
    handle = instrument_manager.get(ip)
    if not handle:
        return jsonify({"error": "not found"}), 404
    return jsonify(handle.state)


@app.route("/instruments/<path:ip>/stream")
def instrument_stream(ip):
    handle = instrument_manager.get(ip)
    if not handle:
        return "not found", 404

    q = handle.register_sse_client()

    def gen():
        try:
            while True:
                msg = q.get()
                yield msg
        except GeneratorExit:
            handle.unregister_sse_client(q)

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


# ── Scan control ────────────────────────────────────────────────────────────

@app.route("/instruments/<path:ip>/scan/configure", methods=["POST"])
def configure_scan(ip):
    handle = instrument_manager.get(ip)
    if not handle:
        return jsonify({"ok": False, "error": "not found"}), 404
    body = request.get_json(force=True)
    try:
        handle.driver.configure_channels(
            handle.resource,
            body["channels"],
            body.get("mtype", "VOLT:DC"),
            body.get("nplc", 1),
        )
        handle.scan_interval = float(body.get("interval", 1))
        handle.scanning = True
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/instruments/<path:ip>/scan/stop", methods=["POST"])
def stop_scan(ip):
    handle = instrument_manager.get(ip)
    if not handle:
        return jsonify({"ok": False, "error": "not found"}), 404
    handle.scanning = False
    try:
        handle.driver.abort(handle.resource)
    except Exception:
        pass
    return jsonify({"ok": True})


# ── Relay control ───────────────────────────────────────────────────────────

@app.route("/instruments/<path:ip>/relay/toggle", methods=["POST"])
def toggle_relay(ip):
    handle = instrument_manager.get(ip)
    if not handle:
        return jsonify({"ok": False, "error": "not found"}), 404
    body = request.get_json(force=True)
    ch = int(body["channel"])
    close = body.get("close", True)
    try:
        if close:
            handle.driver.close_relay(handle.resource, ch)
        else:
            handle.driver.open_relay(handle.resource, ch)
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/instruments/<path:ip>/relay/open_all", methods=["POST"])
def open_all_relays(ip):
    handle = instrument_manager.get(ip)
    if not handle:
        return jsonify({"ok": False, "error": "not found"}), 404
    body = request.get_json(force=True)
    slot = body.get("slot")
    mod = _find_module(handle, slot)
    try:
        handle.driver.open_all_relays(
            handle.resource,
            slot=slot,
            n_channels=mod.get("n_channels", 20),
            card_type=mod.get("card_type", "actuator"),
            rows=mod.get("rows", 4),
            cols=mod.get("cols", 8),
        )
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
