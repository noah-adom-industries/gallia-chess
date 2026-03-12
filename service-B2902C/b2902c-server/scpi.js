/**
 * Raw SCPI-over-TCP client for Keysight instruments.
 * Uses Node built-in `net` — no external dependencies.
 */
import { Socket } from 'net';

export class ScpiClient {
  constructor(host, port = 5025, timeout = 10000) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
    /** @type {Socket|null} */
    this._sock = null;
    this._connected = false;
    this._queue = [];
    this._busy = false;
    /** @type {((cmd: string, response?: string) => void)|null} */
    this.onCommand = null;
  }

  async connect() {
    if (this._connected) return;
    return new Promise((resolve, reject) => {
      const sock = new Socket();
      sock.setTimeout(this.timeout);
      sock.once('connect', () => {
        this._sock = sock;
        this._connected = true;
        resolve();
      });
      sock.once('error', (err) => {
        this._connected = false;
        reject(err);
      });
      sock.once('close', () => {
        this._connected = false;
        this._sock = null;
      });
      sock.connect(this.port, this.host);
    });
  }

  async disconnect() {
    if (this._sock) {
      this._sock.destroy();
      this._sock = null;
      this._connected = false;
    }
  }

  get connected() { return this._connected; }

  /** Send a command that returns no data. */
  async write(cmd) {
    return this._enqueue(() => this._rawWrite(cmd));
  }

  /** Send a query and return the trimmed response string. */
  async query(cmd, customTimeout) {
    return this._enqueue(() => this._rawQuery(cmd, customTimeout));
  }

  /* ── internal queue to avoid interleaved commands ── */

  _enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  async _drain() {
    if (this._busy || this._queue.length === 0) return;
    this._busy = true;
    const { fn, resolve, reject } = this._queue.shift();
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    } finally {
      this._busy = false;
      this._drain();
    }
  }

  _rawWrite(cmd) {
    return new Promise((resolve, reject) => {
      if (!this._sock) return reject(new Error('Not connected'));
      this._sock.write(cmd + '\n', 'ascii', (err) => {
        if (err) reject(err);
        else {
          if (this.onCommand) this.onCommand(cmd);
          resolve();
        }
      });
    });
  }

  _rawQuery(cmd, customTimeout) {
    const timeout = customTimeout || this.timeout;
    return new Promise((resolve, reject) => {
      if (!this._sock) return reject(new Error('Not connected'));
      let buf = '';
      const onData = (chunk) => {
        buf += chunk.toString('ascii');
        if (buf.includes('\n')) {
          this._sock.removeListener('data', onData);
          clearTimeout(timer);
          const result = buf.trim();
          if (this.onCommand) this.onCommand(cmd, result);
          resolve(result);
        }
      };
      const timer = setTimeout(() => {
        this._sock.removeListener('data', onData);
        reject(new Error(`Query timeout: ${cmd}`));
      }, timeout);
      this._sock.on('data', onData);
      this._sock.write(cmd + '\n', 'ascii');
    });
  }
}
