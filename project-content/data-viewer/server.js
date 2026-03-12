const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 9091;

// In-memory data store
const dataStore = {}; // { seriesName: [{ x, y, y2?, timestamp }] }
let chartConfig = {
  title: 'Instrument Data Viewer',
  xLabel: 'X',
  yLabel: 'Y',
  y2Label: '',
  chartType: 'line',
  xScale: 'linear',
  yScale: 'linear'
};

// Annotations store: { id: { type, xMin, xMax, yMin, yMax, backgroundColor, borderColor, label } }
let annotations = {};

// SSE clients
const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(json);
}

function addPoint(series, x, y, y2) {
  if (!dataStore[series]) {
    dataStore[series] = [];
  }
  const point = { x, y, timestamp: Date.now() };
  if (y2 !== undefined && y2 !== null) {
    point.y2 = y2;
  }
  dataStore[series].push(point);

  // Limit stored points per series to 50000
  if (dataStore[series].length > 50000) {
    dataStore[series] = dataStore[series].slice(-50000);
  }

  return { series, ...point };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Serve HTML
  if (pathname === '/' && req.method === 'GET') {
    const htmlPath = path.join(__dirname, 'index.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading index.html');
    }
    return;
  }

  // SSE endpoint
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`event: config\ndata: ${JSON.stringify(chartConfig)}\n\n`);

    // Send current data snapshot
    const allSeries = Object.keys(dataStore);
    if (allSeries.length > 0) {
      const snapshot = {};
      for (const s of allSeries) {
        snapshot[s] = dataStore[s];
      }
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    }

    // Send current annotations
    if (Object.keys(annotations).length > 0) {
      res.write(`event: annotations\ndata: ${JSON.stringify(annotations)}\n\n`);
    }

    sseClients.add(res);
    req.on('close', () => { sseClients.delete(res); });
    return;
  }

  // POST /api/data
  if (pathname === '/api/data' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const added = [];

      if (body.points && Array.isArray(body.points)) {
        for (const p of body.points) {
          if (!p.series || p.x === undefined || p.y === undefined) continue;
          added.push(addPoint(p.series, Number(p.x), Number(p.y), p.y2 !== undefined ? Number(p.y2) : undefined));
        }
      } else if (body.series && body.x !== undefined && body.y !== undefined) {
        added.push(addPoint(body.series, Number(body.x), Number(body.y), body.y2 !== undefined ? Number(body.y2) : undefined));
      } else {
        sendJSON(res, 400, { error: 'Invalid data format. Require {series, x, y} or {points: [...]}' });
        return;
      }

      broadcastSSE('data', added);
      sendJSON(res, 200, { ok: true, added: added.length });
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return;
  }

  // GET /api/data
  if (pathname === '/api/data' && req.method === 'GET') {
    if (query.series) {
      sendJSON(res, 200, { series: query.series, data: dataStore[query.series] || [] });
    } else {
      sendJSON(res, 200, dataStore);
    }
    return;
  }

  // DELETE /api/data
  if (pathname === '/api/data' && req.method === 'DELETE') {
    if (query.series) {
      delete dataStore[query.series];
    } else {
      for (const key of Object.keys(dataStore)) {
        delete dataStore[key];
      }
    }
    broadcastSSE('clear', { series: query.series || null });
    sendJSON(res, 200, { ok: true });
    return;
  }

  // POST /api/config
  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (body.title !== undefined) chartConfig.title = body.title;
      if (body.xLabel !== undefined) chartConfig.xLabel = body.xLabel;
      if (body.yLabel !== undefined) chartConfig.yLabel = body.yLabel;
      if (body.y2Label !== undefined) chartConfig.y2Label = body.y2Label;
      if (body.chartType !== undefined) chartConfig.chartType = body.chartType;
      if (body.xScale !== undefined) chartConfig.xScale = body.xScale;
      if (body.yScale !== undefined) chartConfig.yScale = body.yScale;
      broadcastSSE('config', chartConfig);
      sendJSON(res, 200, { ok: true, config: chartConfig });
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return;
  }

  // GET /api/series
  if (pathname === '/api/series' && req.method === 'GET') {
    const series = Object.keys(dataStore).map(name => ({
      name,
      count: dataStore[name].length
    }));
    sendJSON(res, 200, series);
    return;
  }

  // GET /api/config
  if (pathname === '/api/config' && req.method === 'GET') {
    sendJSON(res, 200, chartConfig);
    return;
  }

  // POST /api/annotations — set annotations (replaces all)
  if (pathname === '/api/annotations' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      annotations = body.annotations || body;
      broadcastSSE('annotations', annotations);
      sendJSON(res, 200, { ok: true, count: Object.keys(annotations).length });
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return;
  }

  // GET /api/annotations
  if (pathname === '/api/annotations' && req.method === 'GET') {
    sendJSON(res, 200, annotations);
    return;
  }

  // DELETE /api/annotations
  if (pathname === '/api/annotations' && req.method === 'DELETE') {
    annotations = {};
    broadcastSSE('annotations', annotations);
    sendJSON(res, 200, { ok: true });
    return;
  }

  // 404
  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Data Viewer server running on http://localhost:${PORT}`);
});
