# DAQ970A Switching Matrix — AI Skill

Control a Keysight DAQ970A Data Acquisition System with DAQM904A 4x8 Two-Wire Matrix module over LAN via HTTP API.

**Server:** `http://127.0.0.1:5000` (local) or via coder proxy
**Instrument:** Keysight DAQ970A (S/N MY58000136) at `10.0.3.83:5025`
**Matrix Module:** DAQM904A in Slot 1 — 4 rows x 8 columns, relay-based, 300V/1A/2W
**Start:** `cd pyvisa-testscript && python3 main.py`
**Dependencies:** `pip install flask flask-cors pyvisa pyvisa-py numpy`
**Viewer:** Same URL as server — serves interactive HTML control panel at `/`

## Quick Start

```bash
# 1. Install dependencies (if needed)
pip install --break-system-packages flask flask-cors pyvisa pyvisa-py numpy

# 2. Start the server
cd service-DAQ970A/pyvisa-testscript && python3 main.py

# 3. The instrument auto-connects on startup if previously configured
# Otherwise add it manually:
curl -s -X POST http://localhost:5000/instruments -H 'Content-Type: application/json' \
  -d '{"ip":"10.0.3.83","port":5025}'

# 4. Close a relay
curl -s -X POST http://localhost:5000/instruments/10.0.3.83/relay/toggle \
  -H 'Content-Type: application/json' -d '{"channel":111,"close":true}'

# 5. Open all relays
curl -s -X POST http://localhost:5000/instruments/10.0.3.83/relay/open_all \
  -H 'Content-Type: application/json' -d '{"slot":1}'
```

## Matrix Channel Addressing

For the DAQM904A 4x8 matrix in **Slot 1**, channel numbers are:

```
channel = 100 + (row * 10) + column
```

| | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |
|---|---|---|---|---|---|---|---|---|
| **R1** | 111 | 112 | 113 | 114 | 115 | 116 | 117 | 118 |
| **R2** | 121 | 122 | 123 | 124 | 125 | 126 | 127 | 128 |
| **R3** | 131 | 132 | 133 | 134 | 135 | 136 | 137 | 138 |
| **R4** | 141 | 142 | 143 | 144 | 145 | 146 | 147 | 148 |

## REST API Reference

Base URL: `http://127.0.0.1:5000`

### Instrument Management

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/ping` | GET | — | Health check, returns `"pong"` |
| `/instruments` | GET | — | List connected instruments |
| `/instruments` | POST | `{"ip":"10.0.3.83","port":5025}` | Add and connect to instrument |
| `/instruments/<ip>` | DELETE | — | Remove instrument |
| `/instruments/<ip>/data` | GET | — | Get instrument state |
| `/instruments/<ip>/stream` | GET | — | SSE stream of instrument data |

### Relay Control

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/instruments/<ip>/relay/toggle` | POST | `{"channel":111,"close":true}` | Close or open a single relay |
| `/instruments/<ip>/relay/open_all` | POST | `{"slot":1}` | Open ALL relays on a slot |

### Scan Control

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/instruments/<ip>/scan/configure` | POST | `{"channels":[111,112],"mtype":"VOLT:DC","nplc":1,"interval":1}` | Configure scan channels |
| `/instruments/<ip>/scan/stop` | POST | — | Stop scanning |

## Common Recipes

### SMU Through Matrix (BJT/MOSFET Characterization)

Connect a B2902C SMU through the matrix to a DUT:

**Wiring convention (SMU → Matrix Rows → DUT on Columns):**
- SMU Ch1+ Force → R1
- SMU Ch1- Force → R2
- SMU Ch2+ Force → R3
- SMU Ch2- Force → R4
- DUT pins connected to columns (e.g., Collector=C1, Base=C2, Emitter=C3)

**Example: BJT with Collector=C1, Base=C2, Emitter=C3:**
```bash
DAQ=http://localhost:5000/instruments/10.0.3.83/relay/toggle

# Open all first
curl -s -X POST http://localhost:5000/instruments/10.0.3.83/relay/open_all \
  -H 'Content-Type: application/json' -d '{"slot":1}'

# Close relays one at a time with delays
# Ch1+ (collector) → R1-C1 = 111
curl -s -X POST $DAQ -H 'Content-Type: application/json' -d '{"channel":111,"close":true}'
sleep 0.2
# Ch1- (emitter) → R2-C3 = 123
curl -s -X POST $DAQ -H 'Content-Type: application/json' -d '{"channel":123,"close":true}'
sleep 0.2
# Ch2+ (base) → R3-C2 = 132
curl -s -X POST $DAQ -H 'Content-Type: application/json' -d '{"channel":132,"close":true}'
sleep 0.2
# Ch2- (emitter) → R4-C3 = 143
curl -s -X POST $DAQ -H 'Content-Type: application/json' -d '{"channel":143,"close":true}'
```

**Important:** Close relays one at a time with ~200ms delays between each. Batch closing can sometimes fail to close all relays.

### 4-Wire Kelvin Through Matrix

For 4-wire sense connections, use separate rows for force and sense:
- Ch1+ Force → R1, Ch1+ Sense → R1 (same row, different relay pairs not needed — matrix is 2-wire)
- For true 4-wire through matrix, you need both force and sense on separate rows going to the same column

### Measure Relay Resistance

Use empty columns to measure the resistance added by the matrix relays:
```bash
# Close two relays in an empty column to create a force+sense loop
# Then use SMU to source current and measure voltage
# Typical relay resistance: 1-7 milliohms per 2-relay path
```

## Specifications (DAQM904A)

| Parameter | Value |
|-----------|-------|
| Matrix size | 4 rows x 8 columns (32 crosspoints) |
| Max voltage | 300 V |
| Max current | 1 A |
| Max power | 2 W per crosspoint |
| Switch type | Relay |
| Scan rate | 80 ch/s |
| Contact resistance | < 1 Ω (typical 1-7 mΩ measured) |

## Safety Notes

- Always open all relays before changing DUT wiring
- Max 1A through any relay — set SMU compliance accordingly
- Max 300V across any relay — verify voltage levels before closing
- Close relays one at a time with delays to ensure reliable operation
- The `/relay/open_all` endpoint requires `{"slot":1}` in the body
