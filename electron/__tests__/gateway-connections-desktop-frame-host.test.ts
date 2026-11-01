import { generateKeyPairSync, randomUUID } from 'node:crypto';

import { expect, it, vi } from 'vitest';

import type { DesktopDeviceAuth } from '../desktop/device-auth.js';
import { DesktopObservationHost } from '../desktop/observation-host.js';

const fixture = vi.hoisted(() => ({ options: undefined as any, endpoint: undefined as any, sockets: [] as any[] }));
vi.mock('@xopcai/realtime-client', async original => ({ ...await original<any>(), RealtimeClient: class {
  constructor(options: unknown) { fixture.options = options; }
  setEndpoint(endpoint: unknown) { fixture.endpoint = endpoint; }
  connect() {}
  disconnect() { fixture.endpoint.onDisconnected(); }
} }));
vi.mock('ws', () => ({ default: class {
  readyState = 1; onmessage?: (event: { data: string }) => void;
  send = vi.fn(); close = vi.fn();
  constructor() { fixture.sockets.push(this); }
} }));

function setup() {
  fixture.sockets.length = 0;
  const gatewayId = randomUUID(), deviceId = randomUUID();
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signers: Array<{ sign: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
  const auth = { endpointIdentity: vi.fn(async () => ({ deviceId, displayName: 'fixture', publicKey: 'fixture' })),
    endpointRequest: vi.fn(async () => ({ realtime: { capabilities: ['desktop.device-frames.v1'] } })),
    signEndpointHello: vi.fn(async (hello: any) => hello), connectionProof: vi.fn(async () => 'proof'),
    prepareSignedEndpoint: vi.fn(async (hello: any, _clientId: string): Promise<any> => {
      const signed = await auth.signEndpointHello(hello);
      const signer = { sign: vi.fn(), close: vi.fn() }; signers.push(signer); return { hello: signed, signer };
    }) };
  const onState = vi.fn();
  const host = new DesktopObservationHost({ binding: { profileId: randomUUID(), gatewayId, origin: 'http://127.0.0.1:1', publicKey },
    auth: auth as unknown as DesktopDeviceAuth, appVersion: 'fixture', readState: async () => ({ platform: 'fixture', systemVersion: 'fixture', locale: 'zh', timezone: 'UTC' }),
    deviceFrames: { authorizationRevision: 1 }, onState });
  return { host, auth, signers, onState };
}

it('does not let a late obsolete hello replace the current signer or connection binding', async () => {
  const { host, auth, signers } = setup();
  const old = Promise.withResolvers<any>(), current = Promise.withResolvers<any>();
  auth.signEndpointHello.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
  try {
    await host.start();
    const first = fixture.endpoint.createHello(); const rejected = expect(first).rejects.toThrow('DESKTOP_HOST_STOPPED');
    await vi.waitFor(() => expect(auth.signEndpointHello).toHaveBeenCalledTimes(1));
    fixture.endpoint.onDisconnected();
    const second = fixture.endpoint.createHello(); await vi.waitFor(() => expect(auth.signEndpointHello).toHaveBeenCalledTimes(2));
    const newHello = auth.signEndpointHello.mock.calls[1][0]; current.resolve(newHello); expect(await second).toBe(newHello);
    old.resolve(auth.signEndpointHello.mock.calls[0][0]); await rejected;
    expect(auth.prepareSignedEndpoint).toHaveBeenCalledTimes(2);
    expect(signers[0].close).not.toHaveBeenCalled();
    expect(signers[1].close).toHaveBeenCalled();
  } finally { host.stop(); }
  expect(signers[0].close).toHaveBeenCalled();
});

it('ignores obsolete socket frames while rejecting invalid frames on the current connection', async () => {
  const { host, signers, onState } = setup();
  try {
    await host.start(); await fixture.endpoint.createHello(); fixture.options.createWebSocket('ws://127.0.0.1:1');
    const old = fixture.sockets[0]; fixture.endpoint.onDisconnected(); expect(signers[0].close).toHaveBeenCalled();
    await fixture.endpoint.createHello(); fixture.options.createWebSocket('ws://127.0.0.1:1');
    onState.mockClear(); old.onmessage({ data: '{invalid' }); expect(onState).not.toHaveBeenCalled();
    fixture.sockets[1].onmessage({ data: '{invalid' });
    expect(onState).toHaveBeenCalledWith('error', 'DESKTOP_GATEWAY_FRAME_INVALID');
    expect(signers[1].close).toHaveBeenCalled();
  } finally { host.stop(); }
});

it('refuses a missing negotiated signing capability without silently falling back', async () => {
  const { host, auth } = setup();
  auth.endpointRequest.mockResolvedValue({ realtime: { capabilities: [] } });
  try { await host.start(); await expect(fixture.options.issueTicket()).rejects.toMatchObject({ message: 'DESKTOP_DEVICE_FRAMES_UNSUPPORTED', retryable: false }); }
  finally { host.stop(); }
});
