/**
 * Minimal WebSocket server (RFC 6455) using only Node built-ins.
 * Supports text frames, ping/pong, and broadcast.
 */
import { createHash } from 'crypto';

const MAGIC = '258EAFA5-E914-47DA-95CA-5AB5FC11B65A';

export class WebSocketServer {
  constructor(httpServer) {
    this.clients = new Set();
    httpServer.on('upgrade', (req, socket, head) => {
      if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
        socket.destroy();
        return;
      }
      const key = req.headers['sec-websocket-key'];
      const accept = createHash('sha1').update(key + MAGIC).digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      this.clients.add(socket);
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));

      // Handle incoming frames (for ping/pong and close)
      socket.on('data', (buf) => {
        const opcode = buf[0] & 0x0f;
        if (opcode === 0x8) { // close
          socket.end();
          this.clients.delete(socket);
        } else if (opcode === 0x9) { // ping → pong
          const pong = Buffer.from(buf);
          pong[0] = (pong[0] & 0xf0) | 0xa;
          socket.write(pong);
        }
      });
    });
  }

  /** Send a text message to all connected clients. */
  broadcast(text) {
    const payload = Buffer.from(text, 'utf-8');
    const frame = this._buildFrame(payload);
    for (const client of this.clients) {
      try { client.write(frame); } catch {}
    }
  }

  _buildFrame(payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }
}
