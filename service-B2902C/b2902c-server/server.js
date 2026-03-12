/**
 * B2902C SMU HTTP API Server
 *
 * Exposes every B2902C function over a clean REST API.
 * Also serves the Adom Viewer frontend and a WebSocket
 * for live measurement streaming.
 */
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WebSocketServer } from './ws.js';
import { B2902C } from './b2902c.js';

// Prevent crashes from unhandled rejections (e.g., polling race)
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e?.message || e));

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.B2902C_PORT || '8400', 10);
const SMU_HOST = process.env.B2902C_HOST || '10.0.3.124';
const SMU_PORT = parseInt(process.env.B2902C_SCPI_PORT || '5025', 10);

const smu = new B2902C(SMU_HOST, SMU_PORT);

/* ── Polling state for live viewer ───────────────── */
let pollingInterval = null;
let pollingPaused = false;
let lastState = null;
let wsServer = null;

/* ── SCPI command log (ring buffer, broadcast to viewers) ── */
const scpiLog = [];
const SCPI_LOG_MAX = 200;

smu.scpi.onCommand = (cmd, response) => {
  const entry = { ts: Date.now(), cmd, response: response || null };
  scpiLog.push(entry);
  if (scpiLog.length > SCPI_LOG_MAX) scpiLog.shift();
  wsServer?.broadcast(JSON.stringify({ type: 'scpi', entry }));
};

function startPolling(intervalMs = 500) {
  if (pollingInterval) return;
  pollingInterval = setInterval(async () => {
    if (!smu.connected || pollingPaused) return;
    try {
      lastState = await smu.getFullState();
      lastState.timestamp = Date.now();
      wsServer?.broadcast(JSON.stringify({ type: 'state', data: lastState }));
    } catch (e) {
      console.error('[poll]', e.message);
    }
  }, intervalMs);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/* ── HTTP helpers ─────────────────────────────────── */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res, msg, status = 400) {
  json(res, { error: msg }, status);
}

async function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

/* ── Route handlers ───────────────────────────────── */

const routes = {};

function get(path, handler) { routes[`GET:${path}`] = handler; }
function post(path, handler) { routes[`POST:${path}`] = handler; }

// Health
get('/health', async (req, res) => {
  json(res, {
    ok: true,
    service: 'b2902c-server',
    smuConnected: smu.connected,
    smuHost: SMU_HOST,
    uptime: process.uptime(),
  });
});

// Connection management
post('/connect', async (req, res) => {
  try {
    await smu.connect();
    startPolling();
    const idn = await smu.identity();
    json(res, { connected: true, identity: idn });
  } catch (e) {
    error(res, `Connection failed: ${e.message}`, 502);
  }
});

post('/disconnect', async (req, res) => {
  stopPolling();
  await smu.disconnect();
  json(res, { connected: false });
});

get('/status', async (req, res) => {
  if (!smu.connected) return json(res, { connected: false });
  try {
    const state = await smu.getFullState();
    json(res, { connected: true, ...state });
  } catch (e) {
    error(res, e.message, 500);
  }
});

// Identity / System
get('/identity', async (req, res) => {
  json(res, { identity: await smu.identity() });
});

post('/reset', async (req, res) => {
  // Pause polling — *RST takes several seconds on the B2902C
  pollingPaused = true;
  try {
    await smu.reset();
    // Wait for instrument to settle after reset
    await new Promise(r => setTimeout(r, 2000));
    await smu.clear();
    json(res, { ok: true });
  } catch (e) {
    error(res, e.message, 500);
  } finally {
    pollingPaused = false;
  }
});

post('/clear', async (req, res) => {
  await smu.clear();
  json(res, { ok: true });
});

get('/errors', async (req, res) => {
  const err = await smu.errorQuery();
  json(res, { error: err });
});

// Output control
post('/output/on', async (req, res) => {
  const { channel } = await parseBody(req);
  await smu.enableOutput(channel);
  json(res, { channel, output: true });
});

post('/output/off', async (req, res) => {
  const { channel } = await parseBody(req);
  await smu.disableOutput(channel);
  json(res, { channel, output: false });
});

post('/output/all-off', async (req, res) => {
  await smu.allOutputsOff();
  json(res, { ok: true, message: 'All outputs disabled' });
});

// Source configuration
post('/source/function', async (req, res) => {
  const { channel, mode } = await parseBody(req);
  await smu.setSourceFunction(channel, mode);
  json(res, { channel, sourceFunction: mode });
});

post('/source/voltage', async (req, res) => {
  const { channel, value } = await parseBody(req);
  await smu.setVoltage(channel, value);
  json(res, { channel, voltage: value });
});

post('/source/current', async (req, res) => {
  const { channel, value } = await parseBody(req);
  await smu.setCurrent(channel, value);
  json(res, { channel, current: value });
});

post('/source/voltage-range', async (req, res) => {
  const { channel, range } = await parseBody(req);
  await smu.setVoltageRange(channel, range);
  json(res, { channel, voltageRange: range });
});

post('/source/current-range', async (req, res) => {
  const { channel, range } = await parseBody(req);
  await smu.setCurrentRange(channel, range);
  json(res, { channel, currentRange: range });
});

// Compliance
post('/compliance/voltage', async (req, res) => {
  const { channel, value } = await parseBody(req);
  await smu.setVoltageCompliance(channel, value);
  json(res, { channel, voltageCompliance: value });
});

post('/compliance/current', async (req, res) => {
  const { channel, value } = await parseBody(req);
  await smu.setCurrentCompliance(channel, value);
  json(res, { channel, currentCompliance: value });
});

// Remote Sense (4-wire Kelvin)
post('/sense/remote', async (req, res) => {
  const { channel, enable } = await parseBody(req);
  await smu.setRemoteSense(channel, enable);
  json(res, { channel, remoteSense: enable });
});

get('/sense/remote', async (req, res, url) => {
  const ch = parseInt(url.searchParams.get('channel') || '1');
  const enabled = await smu.getRemoteSense(ch);
  json(res, { channel: ch, remoteSense: enabled });
});

// Sense configuration
post('/sense/function', async (req, res) => {
  const { channel, func } = await parseBody(req);
  await smu.setSenseFunction(channel, func);
  json(res, { channel, senseFunction: func });
});

post('/sense/nplc', async (req, res) => {
  const { channel, func, nplc } = await parseBody(req);
  await smu.setSenseNPLC(channel, func, nplc);
  json(res, { channel, func, nplc });
});

post('/sense/range', async (req, res) => {
  const { channel, func, range } = await parseBody(req);
  await smu.setSenseRange(channel, func, range);
  json(res, { channel, func, range });
});

// Measurements
get('/measure/voltage', async (req, res, url) => {
  const ch = parseInt(url.searchParams.get('channel') || '1');
  json(res, { channel: ch, voltage: await smu.measureVoltage(ch) });
});

get('/measure/current', async (req, res, url) => {
  const ch = parseInt(url.searchParams.get('channel') || '1');
  json(res, { channel: ch, current: await smu.measureCurrent(ch) });
});

get('/measure/resistance', async (req, res, url) => {
  const ch = parseInt(url.searchParams.get('channel') || '1');
  json(res, { channel: ch, resistance: await smu.measureResistance(ch) });
});

get('/measure/all', async (req, res, url) => {
  const ch = parseInt(url.searchParams.get('channel') || '1');
  const m = await smu.measureAll(ch);
  json(res, { channel: ch, ...m });
});

// Sweep
post('/sweep/voltage', async (req, res) => {
  const { channel, start, stop, points, compliance } = await parseBody(req);
  await smu.configureVoltageSweep(channel, start, stop, points, compliance);
  json(res, { channel, sweep: 'voltage', start, stop, points, configured: true });
});

post('/sweep/current', async (req, res) => {
  const { channel, start, stop, points, compliance } = await parseBody(req);
  await smu.configureCurrentSweep(channel, start, stop, points, compliance);
  json(res, { channel, sweep: 'current', start, stop, points, configured: true });
});

post('/sweep/execute', async (req, res) => {
  pollingPaused = true;
  try {
    const { channel, keepOn } = await parseBody(req);
    const data = await smu.executeSweep(channel);
    if (!keepOn) {
      await new Promise(r => setTimeout(r, 500));
      await smu.scpi.query('*OPC?');
      await smu.disableOutput(channel);
      await smu.scpi.query('*OPC?');
    }
    json(res, { channel, ...data });
  } catch (e) {
    try {
      await new Promise(r => setTimeout(r, 500));
      await smu.scpi.query('*OPC?');
      await smu.disableOutput(1);
      await smu.disableOutput(2);
      await smu.scpi.query('*OPC?');
    } catch {}
    error(res, e.message, 500);
  } finally {
    pollingPaused = false;
  }
});

post('/sweep/linked', async (req, res) => {
  pollingPaused = true;
  try {
    const { primaryChannel, sweepType, start, stop, points, compliance,
            stepChannel, stepType, stepStart, stepStop, stepCount, stepCompliance } = await parseBody(req);
    const secCh = stepChannel;
    const priCh = primaryChannel;

    // Set secondary source function
    await smu.setSourceFunction(secCh, stepType === 'current' ? 'CURR' : 'VOLT');

    // Set secondary compliance
    if (stepType === 'current') {
      await smu.setVoltageCompliance(secCh, stepCompliance);
    } else {
      await smu.setCurrentCompliance(secCh, stepCompliance);
    }

    // Turn on secondary
    await smu.enableOutput(secCh);

    // Generate step values
    const stepValues = [];
    for (let i = 0; i < stepCount; i++) {
      stepValues.push(stepStart + (stepStop - stepStart) * i / (stepCount - 1));
    }

    const results = [];
    for (const stepVal of stepValues) {
      // Set secondary level
      if (stepType === 'current') {
        await smu.setCurrent(secCh, stepVal);
      } else {
        await smu.setVoltage(secCh, stepVal);
      }

      // Small settle
      await new Promise(r => setTimeout(r, 200));

      // Configure and run primary sweep
      if (sweepType === 'current') {
        await smu.configureCurrentSweep(priCh, start, stop, points, compliance);
      } else {
        await smu.configureVoltageSweep(priCh, start, stop, points, compliance);
      }
      const data = await smu.executeSweep(priCh);
      results.push({ stepValue: stepVal, voltage: data.voltage, current: data.current });
    }

    // Turn off BOTH channels — wait for instrument to be ready
    await new Promise(r => setTimeout(r, 500));
    await smu.scpi.query('*OPC?');
    await smu.disableOutput(priCh);
    await smu.disableOutput(secCh);
    await smu.scpi.query('*OPC?');

    json(res, { results });
  } catch (e) {
    // Still turn off both channels on error
    try { await new Promise(r => setTimeout(r, 500)); } catch {}
    try { await smu.scpi.query('*OPC?'); } catch {}
    try { await smu.disableOutput(1); } catch {}
    try { await smu.disableOutput(2); } catch {}
    try { await smu.scpi.query('*OPC?'); } catch {}
    error(res, e.message, 500);
  } finally {
    pollingPaused = false;
  }
});

post('/sweep/list', async (req, res) => {
  const { channel, voltages, compliance, delay } = await parseBody(req);
  await smu.configureListSweep(channel, voltages, compliance, delay);
  json(res, { channel, points: voltages.length, configured: true });
});

// Pulse
post('/pulse/configure', async (req, res) => {
  const { channel, base, pulse, width, period, count } = await parseBody(req);
  await smu.configurePulse(channel, base, pulse, width, period, count);
  json(res, { channel, configured: true });
});

// Raw SCPI
post('/scpi/write', async (req, res) => {
  const { command } = await parseBody(req);
  await smu.rawWrite(command);
  json(res, { ok: true, command });
});

get('/scpi/log', async (req, res) => {
  json(res, { log: scpiLog.slice(-50) });
});

post('/scpi/query', async (req, res) => {
  const { command } = await parseBody(req);
  const result = await smu.rawQuery(command);
  json(res, { command, result });
});

/* ── HTTP server ──────────────────────────────────── */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Strip Coder proxy prefix (e.g. /proxy/8400) so routes match
  url.pathname = url.pathname.replace(/^\/proxy\/\d+/, '');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve viewer HTML
  if (url.pathname === '/' || url.pathname === '/viewer') {
    try {
      const html = await readFile(join(__dirname, 'viewer.html'), 'utf-8');
      cors(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      error(res, 'Viewer not found', 404);
    }
    return;
  }

  // API routes
  const key = `${req.method}:${url.pathname}`;
  const handler = routes[key];
  if (handler) {
    try {
      await handler(req, res, url);
    } catch (e) {
      console.error(`[${key}]`, e.message);
      error(res, e.message, 500);
    }
    return;
  }

  // 404
  json(res, { error: 'Not found', path: url.pathname }, 404);
});

/* ── WebSocket server (piggybacks on HTTP server) ── */

wsServer = new WebSocketServer(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[b2902c-server] Running on port ${PORT}`);
  console.log(`[b2902c-server] SMU target: ${SMU_HOST}:${SMU_PORT}`);
  console.log(`[b2902c-server] Viewer: http://localhost:${PORT}/`);
});
