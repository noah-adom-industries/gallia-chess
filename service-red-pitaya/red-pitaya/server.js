// Red Pitaya Middleware Service
// Single RP connection → process data → broadcast to multiple WS clients
// Runs in service-red-pitaya container as the middleman for all RP interaction
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const WebSocket = require('ws');

// ─── Configuration ───────────────────────────────────────────
const RP_HOST = process.env.RP_HOST || '10.0.5.108';
const RP_PORT = parseInt(process.env.RP_PORT || '80');
const PORT = parseInt(process.env.PORT || '8092');
const APP_ID = process.env.RP_APP || 'scopegenpro';

console.log(`[config] RP_HOST=${RP_HOST} RP_PORT=${RP_PORT} PORT=${PORT} APP=${APP_ID}`);

// ─── x1000 Parameter Convention ──────────────────────────────
const X1000_PARAMS = new Set([
  'OSC_TIME_SCALE', 'OSC_CUR1_T', 'OSC_CUR2_T', 'OSC_CUR1_V', 'OSC_CUR2_V',
  'OSC_XY_CUR1_X', 'OSC_XY_CUR2_X', 'OSC_XY_CUR1_Y', 'OSC_XY_CUR2_Y'
]);

// Sweep time: RP uses µs, clients use seconds
const US_TO_S_PARAMS = new Set(['SOUR1_SWEEP_TIME', 'SOUR2_SWEEP_TIME']);

// ─── State Cache ─────────────────────────────────────────────
let latestParams = {};
let latestSignals = {};
let latestViewState = {};
let rpConnected = false;
let rpWs = null;

// ─── Signal Decoding ─────────────────────────────────────────
function decodeSignal(sig) {
  if (!sig || sig.type !== 'f' || sig.size === 0) return null;
  const buf = Buffer.from(sig.value, 'base64');
  const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(floats);
}

// ─── RP Upstream Connection ──────────────────────────────────
function connectToRP() {
  console.log('[RP] Connecting to ws://' + RP_HOST + ':' + RP_PORT + '/wss');
  const ws = new WebSocket('ws://' + RP_HOST + ':' + RP_PORT + '/wss');
  ws.binaryType = 'arraybuffer';

  ws.on('open', () => {
    console.log('[RP] Connected');
    rpConnected = true;
    rpWs = ws;
    broadcastToClients({ type: 'rp_status', connected: true });
    // Configure update rate and request all params
    sendToRP({ parameters: { RP_SIGNAL_PERIOD: { value: 50 } } });
    setTimeout(() => sendToRP({ parameters: { in_command: { value: 'send_all_params' } } }), 100);
  });

  ws.on('message', (data) => {
    try {
      const buf = Buffer.from(data);
      const inflated = zlib.gunzipSync(buf);
      const json = JSON.parse(inflated.toString('utf8'));

      let changedParams = null;
      let signals = null;

      // Process parameters
      if (json.parameters) {
        changedParams = {};
        for (const key in json.parameters) {
          const p = json.parameters[key];
          if (X1000_PARAMS.has(key) && p.value !== undefined) {
            p.value = parseFloat(p.value) / 1000.0;
          }
          if (US_TO_S_PARAMS.has(key) && p.value !== undefined) {
            p.value = parseFloat(p.value) / 1e6;
          }
          latestParams[key] = p;
          changedParams[key] = p;
        }
      }

      // Process signals
      if (json.signals) {
        signals = {};
        for (const name in json.signals) {
          const decoded = decodeSignal(json.signals[name]);
          if (decoded) {
            latestSignals[name] = decoded;
            signals[name] = decoded;
          }
        }
      }

      // Broadcast to all clients
      if (changedParams || signals) {
        const msg = { type: 'update' };
        if (changedParams) msg.params = changedParams;
        if (signals) msg.signals = signals;
        broadcastToClients(msg);
      }
    } catch (e) {
      console.error('[RP] Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[RP] Disconnected, reconnecting in 2s...');
    rpConnected = false;
    rpWs = null;
    broadcastToClients({ type: 'rp_status', connected: false });
    // Restart app and reconnect
    http.get('http://' + RP_HOST + '/bazaar?start=' + APP_ID, () => {}).on('error', () => {});
    setTimeout(connectToRP, 2000);
  });

  ws.on('error', (e) => {
    console.error('[RP] WS error:', e.message);
    ws.close();
  });
}

function sendToRP(obj) {
  if (rpWs && rpWs.readyState === WebSocket.OPEN) {
    rpWs.send(JSON.stringify(obj));
  }
}

// ─── Client WebSocket Server ─────────────────────────────────
let clientCounter = 0;
const clients = new Map();

function broadcastToClients(msg) {
  const json = JSON.stringify(msg);
  for (const [id, client] of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(json);
    }
  }
}

function broadcastToOthers(senderId, msg) {
  const json = JSON.stringify(msg);
  for (const [id, client] of clients) {
    if (id !== senderId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(json);
    }
  }
}

function handleClientMessage(clientId, data) {
  try {
    const msg = JSON.parse(data);
    if (msg.params) {
      console.log('[Client ' + clientId + '] Params:', JSON.stringify(msg.params));
      // Apply x1000 multiplier before sending to RP
      const rpParams = {};
      for (const key in msg.params) {
        rpParams[key] = { ...msg.params[key] };
        if (X1000_PARAMS.has(key) && rpParams[key].value !== undefined) {
          rpParams[key].value = rpParams[key].value * 1000.0;
        }
        if (US_TO_S_PARAMS.has(key) && rpParams[key].value !== undefined) {
          rpParams[key].value = rpParams[key].value * 1e6;
        }
      }
      sendToRP({ parameters: rpParams });
    }
    if (msg.viewState) {
      // Merge into cached view state and relay to all other clients
      Object.assign(latestViewState, msg.viewState);
      broadcastToOthers(clientId, { type: 'viewState', viewState: msg.viewState });
    }
  } catch (e) {
    console.error('[Client ' + clientId + '] Parse error:', e.message);
  }
}

// ─── HTTP Server ─────────────────────────────────────────────
const indexPath = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  // Strip /proxy/PORT prefix if present
  let url = req.url.replace(/^\/proxy\/\d+/, '');
  if (!url.startsWith('/')) url = '/' + url;
  const pathname = url.split('?')[0];

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  if (pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ rpConnected, clientCount: clients.size }));
    return;
  }

  // Embed endpoint: returns HTML with WS URL pre-configured for GV html_interactive
  if (pathname === '/embed') {
    const host = req.headers.host || ('localhost:' + PORT);
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const wsUrl = proto + '://' + host + '/proxy/' + PORT + '/ws';
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace('</head>', '<script>window.SCOPE_WS_URL="' + wsUrl + '";</script></head>');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(html);
    return;
  }

  // ─── REST API ───────────────────────────────────────────────
  const API_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

  // CORS preflight
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, API_HEADERS);
    res.end();
    return;
  }

  // GET /api/state — full state dump
  if (req.method === 'GET' && pathname === '/api/state') {
    res.writeHead(200, API_HEADERS);
    res.end(JSON.stringify({ rpConnected, clientCount: clients.size, params: latestParams, signals: latestSignals, viewState: latestViewState }));
    return;
  }

  // GET /api/params — all cached params
  if (req.method === 'GET' && pathname === '/api/params') {
    res.writeHead(200, API_HEADERS);
    res.end(JSON.stringify(latestParams));
    return;
  }

  // GET /api/params/:key — single param
  if (req.method === 'GET' && pathname.startsWith('/api/params/')) {
    const key = decodeURIComponent(pathname.slice('/api/params/'.length));
    const val = latestParams[key];
    res.writeHead(val ? 200 : 404, API_HEADERS);
    res.end(JSON.stringify(val || { error: 'param not found', key }));
    return;
  }

  // POST /api/params — set params { KEY: value, ... }
  if (req.method === 'POST' && pathname === '/api/params') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const input = JSON.parse(body);
        const rpParams = {};
        for (const key in input) {
          let val = input[key];
          if (typeof val !== 'object' || val === null) val = { value: val };
          rpParams[key] = { ...val };
          if (X1000_PARAMS.has(key) && rpParams[key].value !== undefined) {
            rpParams[key].value = rpParams[key].value * 1000.0;
          }
          if (US_TO_S_PARAMS.has(key) && rpParams[key].value !== undefined) {
            rpParams[key].value = rpParams[key].value * 1e6;
          }
        }
        sendToRP({ parameters: rpParams });
        res.writeHead(200, API_HEADERS);
        res.end(JSON.stringify({ ok: true, sent: Object.keys(input) }));
      } catch (e) {
        res.writeHead(400, API_HEADERS);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/signals — latest signal arrays
  if (req.method === 'GET' && pathname === '/api/signals') {
    res.writeHead(200, API_HEADERS);
    res.end(JSON.stringify(latestSignals));
    return;
  }

  // GET /api/view — current view state
  if (req.method === 'GET' && pathname === '/api/view') {
    res.writeHead(200, API_HEADERS);
    res.end(JSON.stringify(latestViewState));
    return;
  }

  // POST /api/view — set view state and broadcast
  if (req.method === 'POST' && pathname === '/api/view') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const vs = JSON.parse(body);
        Object.assign(latestViewState, vs);
        broadcastToClients({ type: 'viewState', viewState: vs });
        res.writeHead(200, API_HEADERS);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, API_HEADERS);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── HTTP Proxy to RP ──────────────────────────────────────
  // Proxy any unhandled request directly to the Red Pitaya
  if (pathname.startsWith('/rp/')) {
    const rpPath = req.url.replace(/^\/rp/, '');
    const opts = {
      hostname: RP_HOST,
      port: RP_PORT,
      path: rpPath,
      method: req.method,
      headers: { ...req.headers, host: RP_HOST }
    };
    const proxy = http.request(opts, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      headers['access-control-allow-origin'] = '*';
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res, { end: true });
    });
    proxy.on('error', (e) => {
      res.writeHead(502, API_HEADERS);
      res.end(JSON.stringify({ error: 'RP proxy error: ' + e.message }));
    });
    req.pipe(proxy, { end: true });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// WebSocket upgrade
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  // Strip proxy prefix and check path
  let url = req.url.replace(/^\/proxy\/\d+/, '');
  if (!url.startsWith('/')) url = '/' + url;

  if (url === '/ws' || url.startsWith('/ws?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const id = String(++clientCounter);
      clients.set(id, { ws, connectedAt: Date.now() });
      console.log('[Client ' + id + '] Connected (' + clients.size + ' total)');

      // Send full cached state
      ws.send(JSON.stringify({
        type: 'init',
        params: latestParams,
        signals: latestSignals,
        viewState: latestViewState,
        rpConnected
      }));

      ws.on('message', (data) => handleClientMessage(id, data.toString()));

      ws.on('close', () => {
        clients.delete(id);
        console.log('[Client ' + id + '] Disconnected (' + clients.size + ' total)');
      });
    });
  } else {
    socket.destroy();
  }
});

// ─── Start ───────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log('Red Pitaya middleware listening on port ' + PORT);
  console.log('Endpoints:');
  console.log('  GET  /              — Oscilloscope UI');
  console.log('  GET  /embed         — Embeddable UI (for GV)');
  console.log('  GET  /status        — Connection status');
  console.log('  WS   /ws            — Real-time data stream');
  console.log('  GET  /api/state     — Full state dump');
  console.log('  GET  /api/params    — All cached parameters');
  console.log('  GET  /api/params/:k — Single parameter');
  console.log('  POST /api/params    — Set parameters');
  console.log('  GET  /api/signals   — Latest signal data');
  console.log('  GET  /api/view      — View state');
  console.log('  POST /api/view      — Set view state');
  console.log('  *    /rp/*          — Proxy to Red Pitaya');
  // Start the RP app first, then connect
  http.get('http://' + RP_HOST + '/bazaar?start=' + APP_ID, () => {
    console.log('[RP] App started, connecting in 3s...');
    setTimeout(connectToRP, 3000);
  }).on('error', () => {
    console.log('[RP] Bazaar start failed, connecting anyway...');
    setTimeout(connectToRP, 1000);
  });
});
