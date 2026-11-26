// A small WebSocket server (RFC 6455) on Node's built-in http server: the upgrade
// handshake, text frames, fragmentation, ping/pong and close. No npm dependencies.
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');

/** @typedef {import('net').Socket} Socket */
/** @typedef {import('http').IncomingMessage} Req */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 16 * 1024; // the largest message a browser may send us

/** One unmasked server frame. @param {number} opcode @param {Buffer} payload */
function frame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
    head.writeUInt32BE(len % 2 ** 32, 6);
  }
  head[0] = 0x80 | opcode; // FIN + opcode; servers never mask
  return Buffer.concat([head, payload]);
}

/** A server-side connection. Emits 'message' (text) and 'close'. */
class WebSocket extends EventEmitter {
  /** @param {Socket} socket @param {Buffer} [head] bytes already read past the handshake */
  constructor(socket, head) {
    super();
    this.socket = socket;
    /** @type {Buffer} bytes received but not yet parsed into frames */
    this.buf = Buffer.alloc(0);
    /** @type {Buffer[]} pieces of a fragmented message */
    this.parts = [];
    this.partsLen = 0;
    this.closed = false;
    this.alive = true; // reset by each pong; checked by the heartbeat
    socket.setNoDelay(true);
    socket.on('data', (/** @type {Buffer} */ d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('end', () => this.finish());
    socket.on('error', () => this.finish());
    if (head && head.length) this.onData(head);
  }

  /** @param {string} text */
  send(text) {
    if (this.closed || this.socket.destroyed) return;
    this.socket.write(frame(0x1, Buffer.from(text, 'utf8')));
  }

  ping() {
    if (this.closed) return;
    this.socket.write(frame(0x9, Buffer.alloc(0)));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    try { this.socket.end(frame(0x8, body)); } catch { /* already gone */ }
    setTimeout(() => this.socket.destroy(), 2000).unref();
    this.finish();
  }

  terminate() { this.socket.destroy(); this.finish(); }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  /** @param {Buffer} chunk */
  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (!this.closed && this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        if (this.buf.readUInt32BE(2) !== 0) return this.close(1009, 'Too big');
        len = this.buf.readUInt32BE(6);
        off = 10;
      }
      if (!masked) return this.close(1002, 'Frames must be masked');
      if (len > MAX_MESSAGE) return this.close(1009, 'Too big');
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.onFrame(fin, opcode, data);
    }
  }

  /** @param {boolean} fin @param {number} opcode @param {Buffer} data */
  onFrame(fin, opcode, data) {
    if (opcode === 0x8) return this.close(1000);
    if (opcode === 0x9) { if (!this.closed) this.socket.write(frame(0xa, data)); return; }
    if (opcode === 0xa) { this.alive = true; return; }
    if (opcode === 0x2) return this.close(1003, 'Text only');
    if (opcode === 0x1 || opcode === 0x0) {
      if (opcode === 0x1 && this.parts.length) return this.close(1002, 'Unfinished message');
      if (opcode === 0x0 && !this.parts.length) return this.close(1002, 'Nothing to continue');
      this.partsLen += data.length;
      if (this.partsLen > MAX_MESSAGE) return this.close(1009, 'Too big');
      this.parts.push(data);
      if (!fin) return;
      const text = Buffer.concat(this.parts).toString('utf8');
      this.parts = [];
      this.partsLen = 0;
      this.alive = true;
      this.emit('message', text);
      return;
    }
    this.close(1002, 'Unknown frame');
  }
}

/**
 * Finish the handshake for an http 'upgrade' request. Returns the WebSocket, or null
 * after answering with an error.
 * @param {Req} req @param {Socket} socket @param {Buffer} head
 * @returns {WebSocket | null}
 */
function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    reject(socket, 400, 'Bad Request');
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);
  return new WebSocket(socket, head);
}

/** Refuse an upgrade with a plain HTTP status. @param {Socket} socket @param {number} code @param {string} text */
function reject(socket, code, text) {
  try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* gone */ }
  setTimeout(() => socket.destroy(), 1000).unref();
}

module.exports = { accept, reject, WebSocket };
