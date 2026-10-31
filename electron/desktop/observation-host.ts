import { randomUUID } from 'node:crypto';

import { EndpointToolHostController, EndpointToolRegistry, type EndpointToolDefinition } from '@xopcai/endpoint-tools-client';
import { deviceStateDescriptor, screenCaptureDescriptor, type EndpointTurnClaim } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, RealtimeConnectionError, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import WebSocket from 'ws';

import { verifyDesktopGatewayFrame, type DesktopFrameBinding } from '../../src/endpoint-tools/desktop-frame.js';
import type { DesktopDeviceAuth } from './device-auth.js';
import type { DesktopBinding } from './device-identity.js';
import type { DesktopScreenSession } from './screen-session.js';

export type DesktopObservationState = 'connecting' | 'online' | 'offline' | 'stopped' | 'error';

/** A separate remote Host exposes exactly one explicitly approved observation tool. */
export class DesktopObservationHost {
  private stopped = false;
  private realtime?: RealtimeClient;
  private controller?: EndpointToolHostController;
  private frameBinding?: DesktopFrameBinding;
  private claim?: EndpointTurnClaim;
  private deviceId?: string;
  constructor(private readonly options: {
    binding: DesktopBinding; auth: DesktopDeviceAuth; appVersion: string;
    readState(): Promise<{ platform: string; systemVersion: string; locale: string; timezone: string }>;
    onState(state: DesktopObservationState, error?: string): void;
    screen?: DesktopScreenSession;
  }) {}
  origin(): EndpointTurnClaim | undefined { return this.stopped || !this.claim ? undefined : { ...this.claim }; }
  async readyOrigin(): Promise<EndpointTurnClaim | undefined> {
    if (!this.options.screen) return this.origin();
    if (!this.origin() || !this.options.screen.foreground()) return;
    this.controller?.publishAvailability();
    const signal = AbortSignal.timeout(2000);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const claim = this.origin(); if (!claim || !this.options.screen.foreground()) return;
        const status = await this.options.auth.endpointRequest('/api/desktop-host/status', 'GET', undefined, this.deviceId, signal);
        if (status?.endpoints?.some((endpoint: any) => endpoint.endpointId === claim.endpointId && endpoint.availability === 'foreground')) return this.origin();
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } catch { return; }
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.claim = undefined; this.controller?.disconnect(); this.realtime?.disconnect();
    this.options.onState('stopped');
  }
  async start(): Promise<void> {
    if (this.realtime || this.stopped) throw new Error('DESKTOP_HOST_NOT_STARTABLE');
    const identity = await this.options.auth.endpointIdentity();
    this.deviceId = identity.deviceId;
    const clientId = randomUUID(), endpointId = `${identity.deviceId}:${randomUUID()}`;
    const available = () => this.options.screen?.foreground() ? 'foreground' as const : 'background' as const;
    const state: EndpointToolDefinition = { descriptor: deviceStateDescriptor('desktop', 'state'), execute: async (args, context) => {
      if (this.stopped || context.signal.aborted || Object.keys(args).length) throw new Error('DESKTOP_OBSERVATION_DENIED');
      const value = await this.options.readState();
      if (this.stopped || context.signal.aborted) throw new Error('DESKTOP_OBSERVATION_DENIED');
      return { content: [{ type: 'json', value: { ...value, capturedAt: Date.now() } }] };
    } };
    const capture: EndpointToolDefinition = { descriptor: screenCaptureDescriptor(), execute: async (args, context) => {
      const screen = this.options.screen;
      if (!screen || this.stopped || context.signal.aborted || !screen.foreground() || Object.keys(args).length) throw new Error('DESKTOP_OBSERVATION_DENIED');
      const bytes = await screen.capture(context.signal);
      try {
        if (this.stopped || context.signal.aborted || !screen.foreground()) throw new Error('DESKTOP_SCREEN_CAPTURE_CANCELLED');
        const file = await context.uploadFile({ name: 'screenshot.png', mimeType: 'image/png', bytes });
        if (this.stopped || context.signal.aborted || !screen.foreground()) throw new Error('DESKTOP_SCREEN_CAPTURE_CANCELLED');
        return { content: [file] };
      } finally { bytes.fill(0); }
    } };
    const registry = new EndpointToolRegistry([this.options.screen ? capture : state]);
    const controller = new EndpointToolHostController({ registry, getAvailability: available, createMessageId: randomUUID,
      confirm: async request => request.descriptor.name === 'desktop.screen.capture' && !this.stopped && this.options.screen
        ? this.options.screen.confirm(request.signal) : false,
      uploadFile: async (grant, file, context) => {
        if (!this.options.screen || this.stopped || !this.options.screen.foreground()) throw new Error('DESKTOP_FILE_UPLOAD_DISABLED');
        try { return await this.options.auth.uploadScreenshot({ ...context, grant, file, endpointId, deviceId: identity.deviceId }); }
        catch (error) {
          if (error instanceof Error && ['DESKTOP_AUTH_REVOKED', 'DESKTOP_OBSERVATION_DENIED', 'DESKTOP_DEVICE_IDENTITY_MISMATCH'].includes(error.message)) {
            this.stop(); this.options.onState('error', error.message);
          }
          throw error;
        }
      } });
    this.controller = controller;
    const request = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
      if (this.stopped) throw new RealtimeConnectionError('DESKTOP_HOST_STOPPED', false);
      try { return await this.options.auth.endpointRequest(path, method, body, identity.deviceId); }
      catch (error) {
        const code = error instanceof Error ? error.message : 'DESKTOP_HOST_UNAVAILABLE';
        if (['DESKTOP_AUTH_REVOKED', 'DESKTOP_OBSERVATION_DENIED', 'DESKTOP_REENROLLMENT_REQUIRED', 'DESKTOP_DEVICE_IDENTITY_MISMATCH',
          'GATEWAY_IDENTITY_CHANGED', 'GATEWAY_IDENTITY_PROOF_FAILED', 'GATEWAY_PINNED_IDENTITY_REQUIRED'].includes(code)) throw new RealtimeConnectionError(code, false);
        throw error;
      }
    };
    const client = new RealtimeClient({ clientId, clientKind: 'desktop', createMessageId: randomUUID,
      maxReconnectAttempts: 12,
      getWebSocketUrl: () => this.options.binding.origin.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
      issueTicket: async () => {
        const ticket = await request('/api/realtime/tickets', 'POST', { clientId, clientKind: 'desktop', protocolVersion: REALTIME_PROTOCOL_VERSION });
        return { ...ticket, connectionProof: await this.options.auth.connectionProof(ticket.ticket) };
      },
      createWebSocket: url => this.socket(url),
      onStateChange: (state, error) => {
        if (this.stopped) return;
        this.options.onState(state === 'error' ? 'error' : state === 'connected' ? 'online' : 'connecting', error);
      },
    });
    client.setEndpoint({ createHello: async () => {
      await request('/api/endpoint-tools/principals', 'POST', { principalId: identity.deviceId, displayName: identity.displayName,
        publicKey: identity.publicKey, kind: 'desktop', platform: 'desktop' });
      const connectionInstanceId = randomUUID();
      const hello = await this.options.auth.signEndpointHello({ principalId: identity.deviceId, endpointId, connectionInstanceId,
        kind: 'desktop', platform: 'desktop', displayName: identity.displayName, appVersion: this.options.appVersion,
        availability: available(), nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: registry.descriptors() });
      if (this.stopped) throw new RealtimeConnectionError('DESKTOP_HOST_STOPPED', false);
      this.frameBinding = { gatewayId: this.options.binding.gatewayId, deviceId: identity.deviceId, clientId, connectionInstanceId };
      return hello;
    }, onReady: result => {
      if (this.stopped || result.endpointId !== endpointId) return;
      this.claim = { type: 'endpoint', endpointId, token: result.turnToken };
      controller.connect(message => client.sendEndpointMessage(message));
    }, onMessage: message => { if (!this.stopped && this.claim) void controller.handleMessage(message); },
    onDisconnected: () => { this.claim = undefined; controller.disconnect(); if (!this.stopped) this.options.onState('offline'); } });
    this.realtime = client;
    if (this.stopped) return;
    client.connect();
  }
  private socket(url: string): RealtimeWebSocket {
    if (!this.frameBinding || this.stopped) throw new Error('DESKTOP_HOST_STOPPED');
    const binding = { ...this.frameBinding };
    let sequence = 0, ready = false;
    const wire = new WebSocket(url, { maxPayload: 768 * 1024, handshakeTimeout: 15000, followRedirects: false });
    const adapter: RealtimeWebSocket = { get readyState() { return wire.readyState; },
      onopen: null, onmessage: null, onerror: null, onclose: null,
      send: data => wire.send(data), close: (code, reason) => wire.close(code, reason) };
    wire.onopen = event => adapter.onopen?.(event);
    wire.onerror = event => adapter.onerror?.(event);
    wire.onclose = event => adapter.onclose?.(event);
    wire.onmessage = event => {
      if (this.stopped) return;
      try {
        const text = String(event.data), message = JSON.parse(text);
        if (['realtime.ready', 'endpoint.message'].includes(message.kind)) {
          const verified = verifyDesktopGatewayFrame(text, binding, this.options.binding.publicKey, sequence);
          sequence = verified.sequence;
          if (message.kind === 'realtime.ready') ready = true;
          else if (!ready) throw new Error('DESKTOP_GATEWAY_FRAME_INVALID');
        } else if (message.kind !== 'realtime.pong' && message.kind !== 'realtime.error') throw new Error('DESKTOP_GATEWAY_FRAME_INVALID');
        adapter.onmessage?.({ data: text });
      } catch {
        this.stop(); this.options.onState('error', 'DESKTOP_GATEWAY_FRAME_INVALID');
        wire.close(4401, 'Invalid desktop Gateway frame');
      }
    };
    return adapter;
  }
}
