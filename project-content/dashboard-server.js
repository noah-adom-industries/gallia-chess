const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 9090;

const SERVICES = {
  '/rp/': {
    target: 'https://coder.noah-service-red-pitaya-29bd21ba1b873c72.containers.adom.inc/proxy/8092/',
    name: 'Red Pitaya'
  },
  '/smu/': {
    target: 'https://coder.noah-service-b2902c-2c59397aa1172dcc.containers.adom.inc/proxy/8400/',
    name: 'B2902C'
  },
  '/daq/': {
    target: 'https://coder.noah-service-daq970a-db78d913f91b8dc0.containers.adom.inc/proxy/5000/',
    name: 'DAQ970A'
  }
};

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString().slice(11,19)}] ${req.method} ${req.url}`);

  // Test page to verify nested iframes render
  if (req.url === '/test/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body style="background:#238636;color:white;font-size:24px;padding:20px;font-family:monospace;"><h1>NESTED IFRAME WORKS!</h1><p>If you see this green page, nested iframes render correctly.</p></body></html>');
    return;
  }

  // Serve dashboard at root
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(path.join(__dirname, 'equipment-dashboard.html')).pipe(res);
    return;
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-max-age': '86400'
    });
    res.end();
    return;
  }

  // Proxy service requests
  for (const [prefix, svc] of Object.entries(SERVICES)) {
    if (req.url.startsWith(prefix)) {
      const subPath = req.url.slice(prefix.length);
      const targetUrl = new URL(subPath, svc.target);

      const proxyReq = https.request(targetUrl, {
        method: req.method,
        headers: {
          ...req.headers,
          host: targetUrl.host
        },
        rejectUnauthorized: false
      }, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] || '';
        const headers = { ...proxyRes.headers };
        delete headers['content-security-policy'];
        delete headers['x-frame-options'];
        delete headers['content-length'];

        headers['access-control-allow-origin'] = '*';
        headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        headers['access-control-allow-headers'] = 'Content-Type, Authorization';
        res.writeHead(proxyRes.statusCode, headers);

        if (contentType.includes('text/html')) {
          let body = '';
          proxyRes.setEncoding('utf8');
          proxyRes.on('data', chunk => body += chunk);
          proxyRes.on('end', () => {
            res.end(body);
          });
        } else {
          proxyRes.pipe(res);
        }
      });

      proxyReq.on('error', (err) => {
        console.error(`Proxy error for ${svc.name}:`, err.message);
        res.writeHead(502);
        res.end(`Proxy error: ${err.message}`);
      });

      req.pipe(proxyReq);
      return;
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

// WebSocket proxy for live data streams
server.on('upgrade', (req, socket, head) => {
  console.log(`[${new Date().toISOString().slice(11,19)}] WS UPGRADE ${req.url}`);

  for (const [prefix, svc] of Object.entries(SERVICES)) {
    if (req.url.startsWith(prefix)) {
      const subPath = req.url.slice(prefix.length);
      const targetUrl = new URL(subPath, svc.target.replace('https://', 'wss://'));

      const proxyWs = https.request(targetUrl, {
        method: 'GET',
        headers: {
          ...req.headers,
          host: targetUrl.host
        },
        rejectUnauthorized: false
      });

      proxyWs.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        // Send the 101 back to the client
        let rawHeaders = 'HTTP/1.1 101 Switching Protocols\r\n';
        for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
          rawHeaders += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i+1]}\r\n`;
        }
        rawHeaders += '\r\n';
        socket.write(rawHeaders);

        if (proxyHead.length) socket.write(proxyHead);
        if (head.length) proxySocket.write(head);

        // Bidirectional pipe
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);

        proxySocket.on('error', () => socket.destroy());
        socket.on('error', () => proxySocket.destroy());
        proxySocket.on('close', () => socket.destroy());
        socket.on('close', () => proxySocket.destroy());
      });

      proxyWs.on('error', (err) => {
        console.error(`WS proxy error for ${svc.name}:`, err.message);
        socket.destroy();
      });

      proxyWs.end();
      return;
    }
  }

  socket.destroy();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard proxy server on port ${PORT}`);
});
