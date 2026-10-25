import { afterEach, describe, expect, it, vi } from 'vitest';

import { WirelessPhones, parseWirelessServices, validateWirelessHost } from '../wireless.js';
import type { runAdb } from '../adb-command.js';

const instances: WirelessPhones[] = [];
afterEach(() => { for (const instance of instances) instance.close(); instances.length = 0; });
function fixture(lifetime = 500) {
  const state = { services: '', connected: false, online: true, hardware: 'phone-one', guid: 'adb-phone-guid', paired: false };
  const command = vi.fn<typeof runAdb>(async (_path, args, signal) => {
    signal?.throwIfAborted();
    if (args[0] === 'pair') { state.paired = true; return Buffer.from('Successfully paired'); }
    if (args[0] === 'connect') { state.connected = true; return Buffer.from(`connected to ${args[1]}`); }
    if (args[0] === 'devices') return Buffer.from(`List of devices attached\n192.168.1.5:40001\t${state.online ? 'device' : 'offline'} model:Test_Phone\n`);
    if (args.includes('ro.serialno')) return Buffer.from(state.hardware);
    if (args.includes('persist.adb.wifi.guid')) return Buffer.from(state.guid);
    return Buffer.from(state.services);
  });
  const service = new WirelessPhones(command, 2, lifetime); instances.push(service);
  return { service, command, state };
}

describe('wireless ADB', () => {
  it('parses separate dynamic ports and rejects public, malformed and legacy services', () => {
    expect(parseWirelessServices('phone _adb-tls-pairing._tcp 192.168.1.5:39123\nphone _adb-tls-connect._tcp 192.168.1.5:40001\nold _adb._tcp 192.168.1.5:5555\nx _adb-tls-connect._tcp 8.8.8.8:1234\nx _adb-tls-connect._tcp 192.168.1.5:99999')).toEqual([
      { name: 'phone', kind: 'pairing', host: '192.168.1.5', port: 39123 }, { name: 'phone', kind: 'connect', host: '192.168.1.5', port: 40001 },
    ]);
    for (const host of ['localhost', '127.0.0.1', '8.8.8.8', '192.168.1.5;calc', '192.168.999.1']) expect(() => validateWirelessHost(host)).toThrow();
  });
  it('matches the QR instance exactly and handles a connect advertisement already present before pairing', async () => {
    const { service, command, state } = fixture();
    const session = service.create('owner', 'adb');
    const name = /;S:([^;]+);/.exec(session.qrPayload!)![1];
    state.services = `other _adb-tls-pairing._tcp 192.168.1.9:39000\n${name} _adb-tls-pairing._tcp 192.168.1.5:39123\nadb-phone-guid _adb-tls-connect._tcp 192.168.1.5:40001`;
    await vi.waitFor(() => expect(service.get('owner', session.id).status).toBe('connected'));
    expect(command.mock.calls.filter(call => call[1][0] === 'pair')).toHaveLength(1);
    expect(command.mock.calls.find(call => call[1][0] === 'pair')![1][1]).toBe('192.168.1.5:39123');
    expect(service.get('owner', session.id)).toMatchObject({ device: { serial: '192.168.1.5:40001', state: 'device' } });
    expect(service.get('owner', session.id).qrPayload).toBeUndefined();
    expect(JSON.stringify(service.get('owner', session.id))).not.toContain(';P:');
    expect(service.known('192.168.1.5:40001')).toMatchObject({ hardwareSerial: 'phone-one', guid: 'adb-phone-guid' });
  });
  it('supports code pairing and manual connection when mDNS fails', async () => {
    const { service, command } = fixture();
    command.mockImplementation(async (_path, args) => {
      if (args[0] === 'mdns') throw new Error('Unavailable');
      if (args[0] === 'pair') return Buffer.from('Successfully paired');
      if (args[0] === 'connect') return Buffer.from('connected to 192.168.1.5:40001');
      if (args[0] === 'devices') return Buffer.from('List of devices attached\n192.168.1.5:40001 device');
      return Buffer.from(args.includes('ro.serialno') ? 'hardware' : 'guid');
    });
    const session = service.create('owner', 'adb', { host: '192.168.1.5', pairingPort: 39999, code: '012345', connectPort: 40001 });
    await vi.waitFor(() => expect(service.get('owner', session.id).status).toBe('connected'));
    expect(command).toHaveBeenCalledWith('adb', ['pair', '192.168.1.5:39999', '012345'], expect.any(AbortSignal), 25_000);
  });
  it('distinguishes paired connection timeout from an unscanned QR timeout', async () => {
    const { service } = fixture(40);
    const session = service.create('owner', 'adb', { host: '192.168.1.5', pairingPort: 39123, code: '123456' });
    await vi.waitFor(() => expect(service.get('owner', session.id)).toMatchObject({ status: 'timeout', errorCode: 'PHONE_CONNECT_TIMEOUT' }));
    const unscanned = service.create('owner', 'adb');
    await vi.waitFor(() => expect(service.get('owner', unscanned.id)).toMatchObject({ status: 'timeout', errorCode: 'PHONE_PAIRING_TIMEOUT' }));
  });
  it('binds sessions to principals and cancels pending pairing without connecting afterward', async () => {
    const { service, command } = fixture();
    let finish!: (value: Buffer) => void;
    command.mockImplementation(async (_path, args) => args[0] === 'pair' ? new Promise<Buffer>(resolve => { finish = resolve; }) : Buffer.from(''));
    const session = service.create('owner', 'adb', { host: '192.168.1.5', pairingPort: 39123, code: '123456', connectPort: 40001 });
    expect(() => service.get('other', session.id)).toThrow();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    service.cancel('owner', session.id); finish(Buffer.from('Successfully paired'));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(command.mock.calls.some(call => call[1][0] === 'connect')).toBe(false);
    expect(() => service.get('owner', session.id)).toThrow();
  });
  it('requires an online device and authenticated matching identity for reconnect', async () => {
    const { service, state } = fixture();
    const expected = { host: '192.168.1.5', port: 39999, guid: state.guid, hardwareSerial: state.hardware };
    state.services = 'adb-phone-guid _adb-tls-connect._tcp 192.168.1.5:40001';
    expect((await service.reconnect('adb', expected)).device.serial).toBe('192.168.1.5:40001');
    state.hardware = 'other-phone';
    await expect(service.reconnect('adb', expected, undefined, { host: '192.168.1.5', port: 40001 })).rejects.toMatchObject({ code: 'PHONE_WIRELESS_IDENTITY' });
    state.online = false;
    await expect(service.connect('adb', { host: '192.168.1.5', port: 40001 })).rejects.toMatchObject({ code: 'PHONE_DEVICE_OFFLINE' });
  });
  it('uses the mDNS transport serial when ADB auto-connected before explicit connection', async () => {
    const { service, command } = fixture();
    command.mockImplementation(async (_path, args) => {
      if (args[0] === 'connect') return Buffer.from('already connected to 192.168.1.5:40001');
      if (args[0] === 'devices') return Buffer.from('List of devices attached\nadb-guid._adb-tls-connect._tcp device model:Phone');
      if (args[0] === 'mdns') return Buffer.from('adb-guid _adb-tls-connect._tcp 192.168.1.5:40001');
      return Buffer.from(args.includes('ro.serialno') ? 'hardware' : 'adb-guid');
    });
    const result = await service.connect('adb', { host: '192.168.1.5', port: 40001 });
    expect(result.device.serial).toBe('adb-guid._adb-tls-connect._tcp');
    expect(service.known(result.device.serial)).toEqual({ host: '192.168.1.5', port: 40001, guid: 'adb-guid', hardwareSerial: 'hardware' });
  });
  it('uses the GUID returned by pairing to select the correct connection service', async () => {
    const { service, command, state } = fixture();
    const original = command.getMockImplementation()!;
    command.mockImplementation(async (...args) => args[1][0] === 'pair' ? Buffer.from('Successfully paired [guid=adb-phone-guid]') : original(...args));
    state.services = 'other-guid _adb-tls-connect._tcp 192.168.1.5:40002\nadb-phone-guid _adb-tls-connect._tcp 192.168.1.5:40001';
    const session = service.create('owner', 'adb', { host: '192.168.1.5', pairingPort: 39123, code: '123456' });
    await vi.waitFor(() => expect(service.get('owner', session.id).status).toBe('connected'));
    expect(command.mock.calls.filter(call => call[1][0] === 'connect').map(call => call[1][1])).toEqual(['192.168.1.5:40001']);
  });
  it('invalidates the previous session when regenerated and reports failed pairing without connecting', async () => {
    const { service, command } = fixture();
    const previous = service.create('owner', 'adb');
    command.mockImplementation(async (_path, args) => Buffer.from(args[0] === 'pair' ? 'Failed: incorrect pairing code' : ''));
    const current = service.create('owner', 'adb', { host: '192.168.1.5', pairingPort: 39123, code: '123456' });
    expect(() => service.get('owner', previous.id)).toThrow();
    await vi.waitFor(() => expect(service.get('owner', current.id)).toMatchObject({ status: 'error', errorCode: 'PHONE_PAIRING_FAILED' }));
    expect(command.mock.calls.some(call => call[1][0] === 'connect')).toBe(false);
  });
});
