import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { runAdb } from './adb-command.js';
import { parseAdbDevices } from './adb-driver.js';
import { PhoneError, type DiscoveredPhone, type PhoneDevice } from './contracts.js';

type Command = typeof runAdb;
export type WirelessService = { name: string; host: string; port: number; kind: 'pairing' | 'connect' };
export type WirelessStatus = 'waiting' | 'pairing' | 'paired' | 'connecting' | 'connected' | 'timeout' | 'error' | 'cancelled';
export type WirelessSession = { id: string; status: WirelessStatus; expiresAt: number; qrPayload?: string; device?: DiscoveredPhone; errorCode?: string };
type Session = WirelessSession & { owner: string; name?: string; secret: string; controller: AbortController; path: string; host?: string; connectPort?: number; pairedGuid?: string; paired: boolean; task?: Promise<void> };

export function validateWirelessHost(host: string): string {
  // This endpoint is for LAN IPs, never arbitrary hostnames or shell arguments.
  if (isIP(host) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host))
    throw new PhoneError('PHONE_WIRELESS_ADDRESS', 'Enter the phone’s private IPv4 address on the Gateway network');
  return host;
}

export function parseWirelessServices(output: string): WirelessService[] {
  return output.split(/\r?\n/).flatMap(line => {
    const match = /^\s*(\S+)\s+_adb-tls-(pairing|connect)\._tcp\.?\s+(\d+\.\d+\.\d+\.\d+):(\d+)\s*$/.exec(line);
    if (!match) return [];
    const port = Number(match[4]);
    try { validateWirelessHost(match[3]); } catch { return []; }
    return port > 0 && port <= 65535 ? [{ name: match[1].replace(/\._adb-tls-(?:pairing|connect)\._tcp(?:\.local)?\.?$/, ''), kind: match[2] as WirelessService['kind'], host: match[3], port }] : [];
  });
}

/** Pairing credentials are ephemeral; only verified device identities may be registered. */
export class WirelessPhones {
  private controller = new AbortController();
  private sessions = new Map<string, Session>();
  private identities = new Map<string, NonNullable<PhoneDevice['wireless']>>();
  constructor(private command: Command = runAdb, private intervalMs = 1500, private lifetimeMs = 90_000) {}

  async services(path: string, signal?: AbortSignal): Promise<WirelessService[]> {
    signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    return parseWirelessServices((await this.command(path, ['mdns', 'services'], signal, 5000)).toString());
  }
  async discovery(path: string, signal?: AbortSignal) {
    await this.command(path, ['version'], signal, 5000);
    try {
      const check = (await this.command(path, ['mdns', 'check'], signal, 5000)).toString();
      const mdns = !/unavailable|disabled|not available|not running|error/i.test(check);
      return { mdns, services: mdns ? await this.services(path, signal) : [] };
    } catch { signal?.throwIfAborted(); return { mdns: false, services: [] }; }
  }
  known(serial: string) { return this.identities.get(serial); }
  private view(session: Session): WirelessSession {
    return { id: session.id, status: session.status, expiresAt: session.expiresAt,
      ...(session.status === 'waiting' ? { qrPayload: session.qrPayload } : {}), device: session.device, errorCode: session.errorCode };
  }
  get(owner: string, id: string): WirelessSession {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new PhoneError('PHONE_PAIRING_NOT_FOUND', 'Pairing session expired', 404);
    return this.view(session);
  }
  cancel(owner: string, id: string): void {
    this.get(owner, id); const session = this.sessions.get(id)!;
    session.controller.abort(); session.secret = ''; session.qrPayload = undefined; session.status = 'cancelled'; this.sessions.delete(id);
  }
  close(): void { this.controller.abort(); this.controller = new AbortController(); for (const session of this.sessions.values()) session.controller.abort(); this.sessions.clear(); this.identities.clear(); }

  create(owner: string, path: string, input?: { host: string; pairingPort: number; code: string; connectPort?: number }): WirelessSession {
    if (input) validateWirelessHost(input.host);
    for (const [id, session] of this.sessions) {
      if (session.owner === owner || session.expiresAt < Date.now()) { session.controller.abort(); session.secret = ''; this.sessions.delete(id); }
    }
    if (this.sessions.size >= 8) throw new PhoneError('PHONE_PAIRING_BUSY', 'Too many pairing sessions', 409);
    const name = `studio-${randomBytes(8).toString('hex')}`;
    const secret = input?.code ?? randomBytes(16).toString('hex');
    const session: Session = { id: randomUUID(), owner, path, name: input ? undefined : name, secret,
      qrPayload: input ? undefined : `WIFI:T:ADB;S:${name};P:${secret};;`,
      status: input ? 'pairing' : 'waiting', paired: false, expiresAt: Date.now() + this.lifetimeMs,
      controller: new AbortController(), host: input?.host, connectPort: input?.connectPort };
    this.sessions.set(session.id, session);
    session.task = this.run(session, input?.pairingPort);
    return this.view(session);
  }

  private async run(session: Session, pairingPort?: number): Promise<void> {
    const deadline = AbortSignal.timeout(Math.max(1, session.expiresAt - Date.now()));
    const signal = AbortSignal.any([session.controller.signal, deadline]);
    try {
      while (!signal.aborted) {
        // Query every time: connect advertisements can precede pairing.
        const services = await this.services(session.path, signal).catch(() => { signal.throwIfAborted(); return []; });
        if (!session.paired) {
          const pair = pairingPort && session.host ? { host: session.host, port: pairingPort }
            : services.find(item => item.kind === 'pairing' && item.name === session.name);
          if (pair) {
            session.status = 'pairing';
            const output = (await this.command(session.path, ['pair', `${pair.host}:${pair.port}`, session.secret], signal, 25_000)).toString();
            if (!/Successfully paired/i.test(output)) throw new PhoneError('PHONE_PAIRING_FAILED', 'Pairing failed');
            signal.throwIfAborted(); session.pairedGuid = /\[guid=([^\]]+)\]/i.exec(output)?.[1];
            session.paired = true; session.host = pair.host; session.status = 'paired'; session.secret = ''; session.qrPayload = undefined;
          }
        }
        if (session.paired) {
          const candidates = session.connectPort ? [{ host: session.host!, port: session.connectPort }]
            : services.filter(item => item.kind === 'connect' && item.host === session.host && (!session.pairedGuid || item.name === session.pairedGuid || item.name.startsWith(`${session.pairedGuid}-`)));
          for (const endpoint of candidates) {
            session.status = 'connecting';
            try {
              const result = await this.connect(session.path, endpoint, signal, session.pairedGuid ? { guid: session.pairedGuid } : undefined);
              signal.throwIfAborted(); session.device = result.device; session.status = 'connected'; return;
            } catch { signal.throwIfAborted(); session.status = 'paired'; }
          }
        }
        await delay(this.intervalMs, undefined, { signal });
      }
    } catch (error) {
      if (session.controller.signal.aborted) return;
      session.status = deadline.aborted ? 'timeout' : 'error';
      session.errorCode = deadline.aborted ? (session.paired ? 'PHONE_CONNECT_TIMEOUT' : 'PHONE_PAIRING_TIMEOUT')
        : error instanceof PhoneError ? error.code : 'PHONE_PAIRING_FAILED';
    } finally { session.secret = ''; session.qrPayload = undefined; }
  }

  async connect(path: string, endpoint: { host: string; port: number }, signal?: AbortSignal, expected?: { guid: string; hardwareSerial?: string }) {
    signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    validateWirelessHost(endpoint.host);
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) throw new PhoneError('PHONE_WIRELESS_PORT', 'Enter a valid connection port');
    const serial = `${endpoint.host}:${endpoint.port}`;
    const output = (await this.command(path, ['connect', serial], signal, 10_000)).toString();
    if (!/^(?:already )?connected to /im.test(output)) throw new PhoneError('PHONE_CONNECT_FAILED', 'Unable to connect; check wireless debugging and connection port');
    const devices = parseAdbDevices((await this.command(path, ['devices', '-l'], signal)).toString());
    let device = devices.find(item => item.serial === serial && item.state === 'device');
    if (!device) {
      const services = await this.services(path, signal);
      const names = services.filter(item => item.kind === 'connect' && item.host === endpoint.host && item.port === endpoint.port).map(item => item.name);
      device = devices.find(item => item.state === 'device' && names.some(name => item.serial === `${name}._adb-tls-connect._tcp` || item.serial === `${name}._adb-tls-connect._tcp.local.`));
    }
    if (!device) throw new PhoneError('PHONE_DEVICE_OFFLINE', 'Phone is not online and authorized');
    const hardwareSerial = (await this.command(path, ['-s', device.serial, 'shell', 'getprop', 'ro.serialno'], signal)).toString().trim();
    const guid = (await this.command(path, ['-s', device.serial, 'shell', 'getprop', 'persist.adb.wifi.guid'], signal)).toString().trim();
    if (!hardwareSerial || !guid || hardwareSerial.length > 200 || guid.length > 200 || expected && (expected.hardwareSerial && expected.hardwareSerial !== hardwareSerial || expected.guid !== guid))
      throw new PhoneError('PHONE_WIRELESS_IDENTITY', 'Phone identity changed; pair the intended device again');
    signal?.throwIfAborted();
    const wireless = { host: endpoint.host, port: endpoint.port, hardwareSerial, guid };
    if (this.identities.size >= 100) this.identities.delete(this.identities.keys().next().value!);
    this.identities.set(device.serial, wireless);
    return { device, wireless };
  }
  async reconnect(path: string, wireless: NonNullable<PhoneDevice['wireless']>, signal?: AbortSignal, endpoint?: { host: string; port: number }) {
    signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    if (endpoint) return this.connect(path, endpoint, signal, wireless);
    const services = await this.services(path, signal).catch(() => { signal?.throwIfAborted(); return []; });
    const candidates = services.filter(item => item.kind === 'connect' && (item.name === wireless.guid || item.name.startsWith(`${wireless.guid}-`)));
    for (const item of [...candidates, wireless]) {
      try { return await this.connect(path, item, signal, wireless); } catch { signal?.throwIfAborted(); }
    }
    throw new PhoneError('PHONE_RECONNECT_FAILED', 'Enable wireless debugging on the same network, or enter its current connection address');
  }
}
