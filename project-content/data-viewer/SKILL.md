# Data Viewer — AI Skill

Flexible Chart.js-based data visualization tool for displaying measurement data from instruments. Supports real-time streaming, multiple series, annotations, log/linear scales, and CSV export.

**Server:** `http://127.0.0.1:9091` (local) or via coder proxy
**Start:** `node server.js` (from `project-content/data-viewer/`)
**Dependencies:** None (vanilla Node.js HTTP server, Chart.js loaded via CDN)

## Quick Start

```bash
# 1. Start the server
cd project-content/data-viewer && node server.js

# 2. Configure the chart
curl -s -X POST http://localhost:9091/api/config -H 'Content-Type: application/json' \
  -d '{"title":"My Chart","xLabel":"Voltage (V)","yLabel":"Current (mA)"}'

# 3. Send data points
curl -s -X POST http://localhost:9091/api/data -H 'Content-Type: application/json' \
  -d '{"series":"Channel 1","x":1.5,"y":3.2}'

# 4. Send batch data
curl -s -X POST http://localhost:9091/api/data -H 'Content-Type: application/json' \
  -d '{"points":[{"series":"Ch1","x":0,"y":0},{"series":"Ch1","x":1,"y":2.5},{"series":"Ch1","x":2,"y":5.1}]}'
```

## REST API Reference

All endpoints accept/return JSON. Base URL: `http://127.0.0.1:9091`

### Data

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/data` | POST | `{"series":"name","x":0,"y":1}` or `{"points":[...]}` | Add data point(s). Each point needs `series`, `x`, `y`, optional `y2` |
| `/api/data` | GET | `?series=name` (optional) | Get all data or specific series |
| `/api/data` | DELETE | `?series=name` (optional) | Clear all data or specific series |

### Configuration

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/config` | POST | See below | Update chart configuration (partial updates OK) |
| `/api/config` | GET | — | Get current configuration |

**Config fields:**
```json
{
  "title": "Chart Title",
  "xLabel": "X Axis Label",
  "yLabel": "Y Axis Label",
  "y2Label": "Secondary Y Axis Label",
  "chartType": "line",
  "xScale": "linear",
  "yScale": "linear"
}
```

- `chartType`: `"line"` or `"scatter"`
- `xScale` / `yScale`: `"linear"` or `"logarithmic"`

### Annotations

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/annotations` | POST | `{annotations}` | Set annotations (replaces all). Uses chartjs-plugin-annotation format |
| `/api/annotations` | GET | — | Get current annotations |
| `/api/annotations` | DELETE | — | Clear all annotations |

**Annotation types:**
```json
{
  "regionBox": {
    "type": "box",
    "xMin": 0, "xMax": 1.5,
    "backgroundColor": "rgba(255, 150, 50, 0.10)",
    "borderColor": "rgba(255, 150, 50, 0.4)",
    "borderWidth": 1,
    "label": {
      "display": true,
      "content": "Region Name",
      "position": "center",
      "color": "#ff9932",
      "font": {"size": 13, "weight": "bold"}
    }
  },
  "thresholdLine": {
    "type": "line",
    "xMin": 1.15, "xMax": 1.15,
    "borderColor": "rgba(255, 100, 100, 0.7)",
    "borderWidth": 2,
    "borderDash": [6, 4],
    "label": {
      "display": true,
      "content": "Vth = 1.15V",
      "position": "end",
      "color": "#ff6666",
      "backgroundColor": "rgba(30, 30, 46, 0.85)",
      "font": {"size": 11, "weight": "bold"}
    }
  },
  "horizontalLine": {
    "type": "line",
    "yMin": 200, "yMax": 200,
    "borderColor": "rgba(255, 60, 60, 0.5)",
    "borderWidth": 2,
    "borderDash": [8, 4],
    "label": {
      "display": true,
      "content": "200mA Compliance",
      "position": "center",
      "color": "#ff4444"
    }
  }
}
```

### Series Info

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/series` | GET | List series with point counts |

### Real-time Streaming

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET (SSE) | Server-Sent Events stream. Events: `config`, `snapshot`, `data`, `annotations`, `clear` |

The frontend uses SSE with automatic polling fallback (every 2s) if SSE fails through the coder proxy.

## Displaying in Adom Workspace

The data viewer runs as a web view panel in the Adom workspace. To set it up:

```bash
# The URL through the coder proxy:
# https://coder.<container-slug>.containers.adom.inc/proxy/9091/
```

**Important:** All API paths in the frontend use relative URLs (e.g., `api/data` not `/api/data`) for coder proxy compatibility.

To refresh the web view panel after code changes:
```bash
API_KEY=$(cat /var/run/adom/api-key)
curl -s -X PATCH -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"panelId":"<leaf-id>","action":"refresh"}' \
  "https://hydrogen.adom.inc/api/panels/webview/<owner>/<repo>"
```

## Common Recipes

### Display BJT IV Curves with Region Annotations
```bash
# 1. Clear and configure
curl -s -X DELETE http://localhost:9091/api/data
curl -s -X DELETE http://localhost:9091/api/annotations
curl -s -X POST http://localhost:9091/api/config -H 'Content-Type: application/json' \
  -d '{"title":"2N3904 BJT IV Curve","xLabel":"Vce (V)","yLabel":"Ic (mA)","xScale":"logarithmic","yScale":"logarithmic"}'

# 2. Send sweep data (current in mA)
curl -s -X POST http://localhost:9091/api/data -H 'Content-Type: application/json' \
  -d '{"points":[{"series":"Ib=0.1mA","x":0.01,"y":0.05},{"series":"Ib=0.1mA","x":0.1,"y":5.2}]}'

# 3. Add region annotations
curl -s -X POST http://localhost:9091/api/annotations -H 'Content-Type: application/json' \
  -d '{"saturation":{"type":"box","xMin":0,"xMax":0.5,"backgroundColor":"rgba(255,150,50,0.1)","label":{"display":true,"content":"Saturation","color":"#ff9932"}}}'
```

### Display MOSFET Transfer Characteristic
```bash
curl -s -X POST http://localhost:9091/api/config -H 'Content-Type: application/json' \
  -d '{"title":"2N7000 Transfer Characteristic","xLabel":"Vgs (V)","yLabel":"Id (mA)","xScale":"linear","yScale":"linear"}'
```

### Switch Between Log and Linear Scale
```bash
# Set log-log
curl -s -X POST http://localhost:9091/api/config -H 'Content-Type: application/json' \
  -d '{"xScale":"logarithmic","yScale":"logarithmic"}'

# Set back to linear
curl -s -X POST http://localhost:9091/api/config -H 'Content-Type: application/json' \
  -d '{"xScale":"linear","yScale":"linear"}'
```

## UI Features

- **Dark theme** (background #1e1e2e, accent #00b8b0)
- **Series toggle buttons** — click to show/hide individual series
- **View modes** — Chart, Table, or Both
- **Zoom/Pan** — scroll to zoom, drag to pan, double-click to reset
- **CSV export** — exports all data with series, x, y, y2, timestamp columns
- **Dual Y-axis** — automatic Y2 axis when data includes `y2` values
- **50,000 point limit** per series (server-side ring buffer)

## Architecture

- **Server:** Plain Node.js HTTP server (no npm dependencies) on port 9091
- **Frontend:** Single HTML file with Chart.js + chartjs-plugin-zoom + chartjs-plugin-annotation (CDN)
- **Data store:** In-memory object `{ seriesName: [{x, y, y2?, timestamp}] }`
- **Real-time:** SSE broadcast to all connected clients, with polling fallback for proxy environments
