import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { verifyDeviceConnectionProof } from '../gateway/security/device-request-proof.js';
import { PhonePointerSchema } from './live-provider.js';
import type { PhoneInteractiveSession } from './interactive-session.js';
import { PhoneError } from './contracts.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PhoneStream');
const { WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');
type Claim = { deviceId?: string; readOnly?: boolean; inputEpoch?: number; origin: string; principal: string; expiresAt: number; client: string;
  connect: () => Promise<PhoneInteractiveSession>; validate: () => Promise<void>; disconnect: () => Promise<void> };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const releaseSchema = z.object({ type: z.literal('cancelPointers'), epoch: z.number().int().positive() }).strict();

export class PhoneStreamGateway {
  private connections = new Map<WebSocket, Claim>();
  private tickets = new Map<string, Claim>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has('xopc-phone-v1') ? 'xopc-phone-v1' : false });
  constructor(private principalActive: (principal: string) => boolean = () => true) {}
  issue(claim: Omit<Claim, 'expiresAt'>): { ticket: string; path: string } {
    for (const [key, value] of this.tickets) if (value.expiresAt < Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 100) throw new PhoneError('PHONE_VIEW_BUSY', 'Too many pending phone viewers', 409);
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(hash(ticket), { ...claim, expiresAt: Date.now() + 30_000 });
    return { ticket, path: '/api/phone/live/v1/ws' };
  }
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
    if (new URL(req.url ?? '/', 'http://gateway.local').pathname !== '/api/phone/live/v1/ws') return false;
    const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim());
    const ticket = protocols.find(value => /^[\w-]{43}$/.test(value)) ?? '';
    const key = hash(ticket); const claim = this.tickets.get(key); this.tickets.delete(key);
    if (!protocols.includes('xopc-phone-v1') || !claim || claim.expiresAt < Date.now() || (claim.deviceId ? !verifyDeviceConnectionProof(claim.deviceId, ticket, '/api/phone/live/v1/ws', typeof req.headers['x-xopc-proof'] === 'string' ? req.headers['x-xopc-proof'] : undefined) : req.headers.origin !== claim.origin)
      || !this.principalActive(claim.principal) || this.wss.clients.size >= 16) { socket.destroy(); return true; }
    this.wss.handleUpgrade(req, socket, head, ws => { void this.connection(ws, claim); }); return true;
  }
  private async connection(ws: WebSocket, claim: Claim): Promise<void> {
    this.connections.set(ws, claim);
    let stream: PhoneInteractiveSession | undefined; let unsubscribe: (() => void) | undefined;
    let disposed = false; let validating = false; let lastSeen = Date.now(); let lastFault = ''; let packets = 0;
    let windowAt = Date.now(); let events = 0;
    const send = (body: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(body)); };
    const fail = (code: string) => { if (code !== lastFault) send({ type: 'fault', code }); lastFault = code; };
    const timer = setInterval(() => {
      if (disposed) return;
      if (!this.principalActive(claim.principal) || Date.now() - lastSeen > 12_000) { ws.close(4401, 'Viewer expired'); return; }
      // Native PONGs work even when browser application timers are throttled.
      if (ws.readyState === ws.OPEN) ws.ping();
      if (!validating) { validating = true; void claim.validate().catch(error => {
        log.warn({ phase: 'stream_revalidate', errorCode: error instanceof PhoneError ? error.code : 'PHONE_ACCESS_CHANGED' }, 'Phone video authorization changed');
        ws.close(4403, 'Phone access changed');
      }).finally(() => { validating = false; }); }
    }, 2000);
    const cleanup = async () => { if (disposed) return; disposed = true; this.connections.delete(ws); clearInterval(timer); unsubscribe?.(); await claim.disconnect().catch(() => {}); };
    ws.on('error', () => ws.terminate()); ws.once('close', () => { void cleanup(); });
    ws.on('pong', () => { lastSeen = Date.now(); });
    let inputs = Promise.resolve(); let queuedInputs = 0;
    ws.on('message', (bytes, binary) => {
      if (disposed || ws.readyState !== ws.OPEN) return;
      if (queuedInputs >= 32) { ws.close(4408, 'Input queue full'); return; }
      queuedInputs++;
      inputs = inputs.then(async () => {
      try {
        if (disposed || ws.readyState !== ws.OPEN) return;
        if (binary) throw new Error('Unexpected binary input');
        const input: unknown = JSON.parse(bytes.toString());
        if ((input as { type?: string }).type === 'ping') { lastSeen = Date.now(); send({ type: 'pong' }); return; }
        if (!stream || disposed) throw new Error('Phone video not ready');
        if (!this.principalActive(claim.principal)) throw new PhoneError('PHONE_ACCESS_REVOKED', 'Phone authorization expired', 403);
        await claim.validate();
        if (disposed || ws.readyState !== ws.OPEN) return;
        if (claim.readOnly) throw new PhoneError('PHONE_OBSERVE_ONLY', 'This stream is read only', 403);
        const epoch = (input as { epoch?: number }).epoch;
        if (claim.inputEpoch !== undefined && epoch !== claim.inputEpoch) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Control changed', 409);
        const cancel = releaseSchema.safeParse(input);
        if (cancel.success) { stream.authorizeClient(claim.client, cancel.data.epoch); void stream.revoke().catch(() => ws.close(4411, 'Touch release failed')); return; }
        const pointer = PhonePointerSchema.parse(input);
        if (Date.now() - windowAt > 1000) { windowAt = Date.now(); events = 0; }
        if (++events > 120) throw new Error('Input rate exceeded');
        lastSeen = Date.now(); const startedAt = performance.now();
        await stream.input(claim.client, pointer).then(() => send({ type: 'ack', seq: pointer.seq, phase: 'transport-written', durationMs: performance.now() - startedAt }), error => {
          const code = error instanceof PhoneError ? error.code : 'PHONE_INPUT_FAILED';
          log.warn({ phase: 'input_dispatch', errorCode: code }, 'Phone input channel closed after refused input');
          fail(code); ws.close(4409, 'Input rejected');
        });
      } catch (error) {
        const code = error instanceof PhoneError ? error.code : 'PHONE_INVALID_INPUT';
        log.info({ phase: 'input_validation', errorCode: code,
          issues: error instanceof z.ZodError ? error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) : undefined }, 'Phone input refused');
        fail(code); ws.close(4400, 'Invalid input');
      }
    }).finally(() => { queuedInputs--; }); });
    try {
      await claim.validate(); stream = await claim.connect();
      if (disposed || ws.readyState !== ws.OPEN) { await claim.disconnect(); return; }
      send({ type: 'ready', descriptor: stream.provider.descriptor });
      unsubscribe = stream.subscribe(claim.client, packet => {
        if (ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > 1024 * 1024) { ws.close(4408, 'Video consumer too slow'); return; }
        const geometry = packet.geometry ?? stream!.provider.geometry;
        if (packet.config) send({ type: 'geometry', ...geometry });
        const header = Buffer.alloc(32); header[0] = (packet.config ? 1 : 0) | (packet.key ? 2 : 0);
        header.writeUInt32BE(geometry.version, 4); header.writeUInt16BE(geometry.width, 8); header.writeUInt16BE(geometry.height, 10);
        header.writeBigUInt64BE(BigInt(packet.pts), 12); header.writeDoubleBE(Date.now(), 20); header.writeUInt32BE(++packets, 28);
        lastFault = ''; ws.send(Buffer.concat([header, packet.data]));
      }, code => { fail(code); if (code === 'PHONE_VIDEO_ENDED') ws.close(1000, 'Phone session ended'); });
    } catch (error) {
      const code = error instanceof PhoneError ? error.code : 'PHONE_VIDEO_FAILED'; fail(code);
      log.info({ phase: 'stream_start', errorCode: code }, 'Phone video unavailable'); ws.close(4411, 'Phone video unavailable');
    }
  }
  disconnectPrincipal(principal: string): void {
    for (const [key, claim] of this.tickets) if (claim.principal === principal) this.tickets.delete(key);
    for (const [ws, claim] of this.connections) if (claim.principal === principal) ws.close(4403, 'Phone authorization changed');
  }
  close(): void { this.tickets.clear(); for (const ws of this.wss.clients) ws.terminate(); this.wss.close(); }
}
