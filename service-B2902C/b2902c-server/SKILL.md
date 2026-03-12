# B2902C SMU Control — AI Skill

Control a Keysight B2902C Precision Source/Measure Unit over LAN via HTTP API.

**Server:** `http://127.0.0.1:8400` (local) or `https://coder.noah-service-b2902c-2c59397aa1172dcc.containers.adom.inc/proxy/8400/` (public)
**Instrument:** Keysight B2902C (S/N MY65150400, FW 6.0.516.0) at `10.0.3.124:5025`
**Viewer:** Same URL as server — serves interactive HTML control panel at `/`

## Quick Start

```bash
# 1. Connect to the SMU
curl -s -X POST http://127.0.0.1:8400/connect

# 2. Set channel 1 to source 3.3V with 100mA compliance
curl -s -X POST http://127.0.0.1:8400/source/function -H 'Content-Type: application/json' -d '{"channel":1,"mode":"VOLT"}'
curl -s -X POST http://127.0.0.1:8400/source/voltage -H 'Content-Type: application/json' -d '{"channel":1,"value":3.3}'
curl -s -X POST http://127.0.0.1:8400/compliance/current -H 'Content-Type: application/json' -d '{"channel":1,"value":0.1}'

# 3. Enable output
curl -s -X POST http://127.0.0.1:8400/output/on -H 'Content-Type: application/json' -d '{"channel":1}'

# 4. Read measurements
curl -s http://127.0.0.1:8400/measure/all?channel=1

# 5. Disable output
curl -s -X POST http://127.0.0.1:8400/output/off -H 'Content-Type: application/json' -d '{"channel":1}'
```

## REST API Reference

All endpoints accept/return JSON. Base URL: `http://127.0.0.1:8400`

### Connection & System

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/health` | GET | — | Health check: `{ok, smuConnected, smuHost, uptime}` |
| `/connect` | POST | — | Connect to SMU, returns `{connected, identity}` |
| `/disconnect` | POST | — | Disconnect from SMU |
| `/status` | GET | — | Full state of both channels (source config, measurements, output state) |
| `/identity` | GET | — | Returns `*IDN?` string |
| `/reset` | POST | — | Send `*RST` (reset to defaults, pauses polling) |
| `/clear` | POST | — | Send `*CLS` (clear error queue) |
| `/errors` | GET | — | Query error queue `SYST:ERR?` |

### Output Control

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/output/on` | POST | `{"channel": 1}` | Enable output on channel 1 or 2 |
| `/output/off` | POST | `{"channel": 1}` | Disable output on channel 1 or 2 |
| `/output/all-off` | POST | — | **Safety:** Disable ALL outputs immediately |

### Source Configuration

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/source/function` | POST | `{"channel":1, "mode":"VOLT"}` | Set source to VOLT or CURR |
| `/source/voltage` | POST | `{"channel":1, "value":3.3}` | Set source voltage level (V) |
| `/source/current` | POST | `{"channel":1, "value":0.001}` | Set source current level (A) |
| `/source/voltage-range` | POST | `{"channel":1, "range":"AUTO"}` | Set voltage range (AUTO or number) |
| `/source/current-range` | POST | `{"channel":1, "range":"AUTO"}` | Set current range (AUTO or number) |

### Compliance (Protection Limits)

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/compliance/voltage` | POST | `{"channel":1, "value":21}` | Voltage compliance when sourcing current |
| `/compliance/current` | POST | `{"channel":1, "value":0.1}` | Current compliance when sourcing voltage |

### 4-Wire Remote Sense (Kelvin)

| Endpoint | Method | Body / Params | Description |
|----------|--------|------|-------------|
| `/sense/remote` | POST | `{"channel":1, "enable":true}` | Enable/disable 4-wire remote sense |
| `/sense/remote` | GET | `?channel=1` | Query remote sense state |

SCPI: `:SENS<n>:REM ON|OFF` (confirmed on B2902C FW 6.0.516.0)

### Measurement (Sense) Configuration

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/sense/function` | POST | `{"channel":1, "func":"CURR"}` | Set sense function: VOLT, CURR, or RES |
| `/sense/nplc` | POST | `{"channel":1, "func":"CURR", "nplc":1}` | Integration time (0.01-10 PLCs) |
| `/sense/range` | POST | `{"channel":1, "func":"CURR", "range":"AUTO"}` | Sense range (AUTO or number) |

### Spot Measurements

| Endpoint | Method | Query Params | Description |
|----------|--------|------|-------------|
| `/measure/voltage` | GET | `?channel=1` | Measure voltage (V) |
| `/measure/current` | GET | `?channel=1` | Measure current (A) |
| `/measure/resistance` | GET | `?channel=1` | Measure resistance (Ω) via :MEAS:RES? |
| `/measure/all` | GET | `?channel=1` | V + I + R (R computed from V/I ratio) |

### Sweep Operations

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/sweep/voltage` | POST | `{"channel":1, "start":0, "stop":5, "points":101, "compliance":0.1}` | Configure linear voltage sweep |
| `/sweep/current` | POST | `{"channel":1, "start":0, "stop":0.01, "points":101, "compliance":21}` | Configure linear current sweep |
| `/sweep/execute` | POST | `{"channel":1}` | Run configured sweep, returns `{voltage[], current[]}`. Output auto-off after. |
| `/sweep/linked` | POST | See below | Run linked dual-channel sweep (e.g. BJT characterization). Output auto-off after. |
| `/sweep/list` | POST | `{"channel":1, "voltages":[0,1,2,3], "compliance":0.1, "delay":0.001}` | Configure arbitrary list sweep |

#### Linked Sweep (`/sweep/linked`)

Runs a primary sweep on one channel while stepping the other channel through a series of DC bias values. Produces one I-V curve per step. Both channels are automatically turned off when done (even on error).

**Body:**
```json
{
  "primaryChannel": 1,
  "sweepType": "voltage",
  "start": 0,
  "stop": 5,
  "points": 101,
  "compliance": 0.1,
  "stepChannel": 2,
  "stepType": "current",
  "stepStart": 0,
  "stepStop": 0.001,
  "stepCount": 11,
  "stepCompliance": 5
}
```

- `sweepType`: `"voltage"` or `"current"` — what the primary channel sweeps
- `stepType`: `"voltage"` or `"current"` — what the secondary channel sources at each step
- `stepCompliance`: voltage compliance (V) if stepType is current, or current compliance (A) if stepType is voltage

**Response:**
```json
{
  "results": [
    {"stepValue": 0, "voltage": [0, 0.05, ...], "current": [0, 0.00045, ...]},
    {"stepValue": 0.0001, "voltage": [...], "current": [...]},
    ...
  ]
}
```

### Pulse Mode

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/pulse/configure` | POST | `{"channel":1, "base":0, "pulse":5, "width":0.001, "period":0.01, "count":10}` | Configure pulsed output |

### Raw SCPI (Advanced)

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/scpi/write` | POST | `{"command":":OUTP1 ON"}` | Send any SCPI command (no response) |
| `/scpi/query` | POST | `{"command":"*IDN?"}` | Send SCPI query, returns `{command, result}` |
| `/scpi/log` | GET | — | Last 50 SCPI commands with responses (ring buffer of 200) |

## Common Recipes

### Power a DUT at 5V, measure current draw
```bash
curl -s -X POST http://127.0.0.1:8400/connect
curl -s -X POST http://127.0.0.1:8400/source/function -H 'Content-Type: application/json' -d '{"channel":1,"mode":"VOLT"}'
curl -s -X POST http://127.0.0.1:8400/source/voltage -H 'Content-Type: application/json' -d '{"channel":1,"value":5.0}'
curl -s -X POST http://127.0.0.1:8400/compliance/current -H 'Content-Type: application/json' -d '{"channel":1,"value":0.5}'
curl -s -X POST http://127.0.0.1:8400/output/on -H 'Content-Type: application/json' -d '{"channel":1}'
curl -s http://127.0.0.1:8400/measure/current?channel=1
```

### 4-wire Kelvin resistance measurement
```bash
curl -s -X POST http://127.0.0.1:8400/sense/remote -H 'Content-Type: application/json' -d '{"channel":1,"enable":true}'
curl -s -X POST http://127.0.0.1:8400/source/function -H 'Content-Type: application/json' -d '{"channel":1,"mode":"CURR"}'
curl -s -X POST http://127.0.0.1:8400/source/current -H 'Content-Type: application/json' -d '{"channel":1,"value":0.001}'
curl -s -X POST http://127.0.0.1:8400/compliance/voltage -H 'Content-Type: application/json' -d '{"channel":1,"value":10}'
curl -s -X POST http://127.0.0.1:8400/output/on -H 'Content-Type: application/json' -d '{"channel":1}'
curl -s http://127.0.0.1:8400/measure/all?channel=1
# Returns: {"channel":1,"voltage":1.1004,"current":0.001,"resistance":1100.4}
```

### Source current, measure voltage (e.g., LED I-V)
```bash
curl -s -X POST http://127.0.0.1:8400/source/function -H 'Content-Type: application/json' -d '{"channel":1,"mode":"CURR"}'
curl -s -X POST http://127.0.0.1:8400/source/current -H 'Content-Type: application/json' -d '{"channel":1,"value":0.020}'
curl -s -X POST http://127.0.0.1:8400/compliance/voltage -H 'Content-Type: application/json' -d '{"channel":1,"value":5}'
curl -s -X POST http://127.0.0.1:8400/output/on -H 'Content-Type: application/json' -d '{"channel":1}'
curl -s http://127.0.0.1:8400/measure/voltage?channel=1
```

### I-V curve sweep (e.g., diode characterization)
```bash
curl -s -X POST http://127.0.0.1:8400/sweep/voltage -H 'Content-Type: application/json' \
  -d '{"channel":1,"start":0,"stop":2,"points":201,"compliance":0.1}'
curl -s -X POST http://127.0.0.1:8400/sweep/execute -H 'Content-Type: application/json' \
  -d '{"channel":1}'
# Returns: {"channel":1, "voltage":[0,0.01,...,2], "current":[...]}
```

### Dual-channel: source + sink
```bash
# Channel 1 sources 3.3V
curl -s -X POST http://127.0.0.1:8400/source/function -H 'Content-Type: application/json' -d '{"channel":1,"mode":"VOLT"}'
curl -s -X POST http://127.0.0.1:8400/source/voltage -H 'Content-Type: application/json' -d '{"channel":1,"value":3.3}'
curl -s -X POST http://127.0.0.1:8400/compliance/current -H 'Content-Type: application/json' -d '{"channel":1,"value":0.5}'
# Channel 2 sinks (sources negative current)
curl -s -X POST http://127.0.0.1:8400/source/function -H 'Content-Type: application/json' -d '{"channel":2,"mode":"CURR"}'
curl -s -X POST http://127.0.0.1:8400/source/current -H 'Content-Type: application/json' -d '{"channel":2,"value":-0.01}'
curl -s -X POST http://127.0.0.1:8400/compliance/voltage -H 'Content-Type: application/json' -d '{"channel":2,"value":10}'
# Enable both
curl -s -X POST http://127.0.0.1:8400/output/on -H 'Content-Type: application/json' -d '{"channel":1}'
curl -s -X POST http://127.0.0.1:8400/output/on -H 'Content-Type: application/json' -d '{"channel":2}'
```

### BJT characterization (linked sweep)
```bash
# Sweep Vce 0→5V on Ch1, step Ib 0→100uA in 11 steps on Ch2
curl -s -X POST http://127.0.0.1:8400/connect
curl -s -X POST http://127.0.0.1:8400/sweep/linked -H 'Content-Type: application/json' -d '{
  "primaryChannel": 1,
  "sweepType": "voltage",
  "start": 0, "stop": 5, "points": 101, "compliance": 0.1,
  "stepChannel": 2,
  "stepType": "current",
  "stepStart": 0, "stepStop": 0.0001, "stepCount": 11,
  "stepCompliance": 5
}'
# Returns 11 I-V curves, one per base current step
# Both channels automatically turned off when done
```

### Current sweep (e.g., LED forward voltage)
```bash
curl -s -X POST http://127.0.0.1:8400/sweep/current -H 'Content-Type: application/json' \
  -d '{"channel":1,"start":0,"stop":0.02,"points":101,"compliance":5}'
curl -s -X POST http://127.0.0.1:8400/sweep/execute -H 'Content-Type: application/json' \
  -d '{"channel":1}'
# Returns: {"channel":1, "voltage":[...], "current":[...]}
# Output automatically turned off after sweep
```

### Log-scale IV sweep with list sweep
```bash
# Generate log-spaced voltages and use list sweep for better resolution at low Vce
python3 -c "
import math, json
voltages = [round(10**(math.log10(0.01) + (math.log10(5) - math.log10(0.01)) * i / 79), 6) for i in range(80)]
print(json.dumps(voltages))
" | xargs -I{} curl -s -X POST http://127.0.0.1:8400/sweep/list \
  -H 'Content-Type: application/json' -d '{"channel":1,"voltages":{},"compliance":0.1,"delay":0.01}'
curl -s -X POST http://127.0.0.1:8400/sweep/execute -H 'Content-Type: application/json' -d '{"channel":1}'
```

### Send sweep data to Data Viewer (port 9091)
```bash
# After running a sweep, parse results and send to data viewer:
# 1. Configure chart
curl -s -X POST http://localhost:9091/api/config -H 'Content-Type: application/json' \
  -d '{"title":"BJT IV Curve","xLabel":"Vce (V)","yLabel":"Ic (mA)","xScale":"logarithmic","yScale":"logarithmic"}'

# 2. Send points (convert current from A to mA)
# Use python to parse sweep JSON and POST batch points to /api/data

# 3. Add region annotations
curl -s -X POST http://localhost:9091/api/annotations -H 'Content-Type: application/json' \
  -d '{"saturation":{"type":"box","xMin":0,"xMax":0.5,...},"active":{"type":"box","xMin":0.5,"xMax":5,...}}'
```

### MOSFET characterization (linked sweep)
```bash
# Sweep Vds 0→0.5V on Ch1, step Vgs 1.50→2.10V in 8 steps on Ch2
curl -s -X POST http://127.0.0.1:8400/sweep/linked -H 'Content-Type: application/json' -d '{
  "primaryChannel": 1,
  "sweepType": "voltage",
  "start": 0, "stop": 0.5, "points": 101, "compliance": 0.2,
  "stepChannel": 2,
  "stepType": "voltage",
  "stepStart": 1.5, "stepStop": 2.1, "stepCount": 8,
  "stepCompliance": 0.2
}'
# Narrow Vds range and high Vgs needed for 2N7000 to avoid compliance clipping
```

### Transfer characteristic (Id vs Vgs)
```bash
# Set Ch1 to fixed Vds, sweep Ch2 (Vgs), measure Id on Ch1
# Use linked sweep with Ch2 as primary sweep, Ch1 as fixed bias
curl -s -X POST http://127.0.0.1:8400/sweep/linked -H 'Content-Type: application/json' -d '{
  "primaryChannel": 2,
  "sweepType": "voltage",
  "start": 0, "stop": 2.5, "points": 101, "compliance": 0.2,
  "stepChannel": 1,
  "stepType": "voltage",
  "stepStart": 0.1, "stepStop": 0.5, "stepCount": 3,
  "stepCompliance": 0.2
}'
```

### Emergency shutdown
```bash
curl -s -X POST http://127.0.0.1:8400/output/all-off
```

## B2902C Specifications (Key)

| Parameter | Range |
|-----------|-------|
| Source voltage | +/-210 V |
| Source current | +/-3 A (DC), +/-10.5 A (pulsed) |
| Voltage resolution | 100 nV (2V range) |
| Current resolution | 100 fA (10 nA range) |
| Channels | 2 (independent) |
| Source modes | Voltage, Current |
| Measurement functions | Voltage, Current, Resistance |
| Sweep types | Linear, List, Log |
| Pulse width | 50 us min |
| Remote sense | 4-wire Kelvin via `:SENS<n>:REM ON` |

## WebSocket Live Data

Connect to `ws://<host>:8400/` for real-time state updates (500ms interval when connected). Messages are JSON:

Two message types are broadcast:

**State updates** (every 500ms):
```json
{
  "type": "state",
  "data": {
    "identity": "Keysight Technologies,B2902C,...",
    "channels": {
      "1": {
        "sourceFunction": "VOLT",
        "outputEnabled": true,
        "sourceVoltage": 3.3,
        "sourceCurrent": 0,
        "voltageCompliance": 21,
        "currentCompliance": 0.1,
        "remoteSense": false,
        "measuredVoltage": 3.2998,
        "measuredCurrent": 0.00234,
        "measuredResistance": 1410.17
      },
      "2": { "..." : "..." }
    },
    "errors": [],
    "timestamp": 1710000000000
  }
}
```

**SCPI command log** (real-time, every command sent to the instrument):
```json
{
  "type": "scpi",
  "entry": {
    "ts": 1710000000000,
    "cmd": ":SOUR1:VOLT 3.3",
    "response": null
  }
}
```
For queries, `response` contains the instrument's reply. For writes, `response` is null.

## Verified SCPI Commands (B2902C FW 6.0.516.0)

These commands have been tested and confirmed working:

| Function | SCPI Command |
|----------|-------------|
| Remote sense ON/OFF | `:SENS<n>:REM ON\|OFF` |
| Remote sense query | `:SENS<n>:REM?` |
| Source function | `:SOUR<n>:FUNC:MODE VOLT\|CURR` |
| Source voltage | `:SOUR<n>:VOLT <value>` |
| Source current | `:SOUR<n>:CURR <value>` |
| Output enable | `:OUTP<n> ON\|OFF` |
| Measure voltage | `:MEAS:VOLT? (@<n>)` |
| Measure current | `:MEAS:CURR? (@<n>)` |
| Voltage compliance | `:SENS<n>:VOLT:PROT <value>` |
| Current compliance | `:SENS<n>:CURR:PROT <value>` |
| NPLC | `:SENS<n>:<FUNC>:NPLC <value>` |
| Sweep start | `:SOUR<n>:VOLT:STAR <value>` |
| Sweep stop | `:SOUR<n>:VOLT:STOP <value>` |
| Sweep points | `:SOUR<n>:VOLT:POIN <count>` |
| Fetch sweep data | `:FETC:ARR:VOLT? (@<n>)` / `:FETC:ARR:CURR? (@<n>)` |

**Known invalid commands:** `:SYST:RSEN<n>` (use `:SENS<n>:REM` instead)

## Safety Notes

- Always set compliance limits BEFORE enabling output
- Use `/output/all-off` for emergency shutdown
- The B2902C can source up to 210V — double-check voltage values
- Sweeps automatically disable output after completion (server-side, with `*OPC?` synchronization)
- Linked sweeps turn off BOTH channels after completion, even if an error occurs
- The server serializes all SCPI commands — no interleaving issues
- Reset (`/reset`) pauses the polling loop to avoid SCPI queue contention
