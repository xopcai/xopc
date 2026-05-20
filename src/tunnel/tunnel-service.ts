import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { PACKAGE_VERSION } from '../package-version.js';
import { createLogger } from '../utils/logger.js';
import { TunnelBrokerClient, resolveBrokerApiBase } from './broker-client.js';
import { ensureFrpcBinary } from './frpc-binary.js';
import { writeFrpcConfig } from './frpc-config.js';
import { type FrpcProcessHandle, spawnFrpcProcess } from './frpc-process.js';
import { buildMobileConnectQrPayload, resolveLanGatewayUrl } from './tunnel-qr.js';
import {
  canResumePersistedTunnel,
  persistedFromRegistration,
  registrationFromPersisted,
} from './tunnel-persist.js';
import { loadTunnelState, saveTunnelState, updateTunnelState } from './tunnel-state.js';
import type { PersistedTunnelState, TunnelQrPayload, TunnelRegistration, TunnelStatus } from './tunnel-types.js';

const log = createLogger('Tunnel');

export type TunnelServiceConfig = {
  brokerUrl: string;
  registrationSecret: string;
  autoStart: boolean;
  gatewayHost: string;
};

export function hashGatewayToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function platformLabel(): string {
  return `${process.platform}-${process.arch}`;
}

let singleton: TunnelService | null = null;

export function getTunnelService(): TunnelService {
  if (!singleton) singleton = new TunnelService();
  return singleton;
}

export class TunnelService extends EventEmitter {
  private serviceConfig: TunnelServiceConfig | null = null;
  private frpcHandle: FrpcProcessHandle | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectedSince: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private lastError: string | null = null;
  private state: TunnelStatus['state'] = 'disconnected';
  private reconnectAttempt = 0;
  private stopping = false;
  private startContext: { gatewayPort: number; gatewayToken: string } | null = null;

  configure(cfg: TunnelServiceConfig): void {
    this.serviceConfig = cfg;
  }

  getStatus(): TunnelStatus {
    const cfg = this.serviceConfig;
    const persisted = loadTunnelState();
    return {
      enabled: this.state === 'connected' || this.state === 'connecting' || this.state === 'reconnecting',
      state: this.state,
      subdomain: persisted?.subdomain ?? null,
      publicUrl: persisted?.publicUrl ?? null,
      connectedSince: this.connectedSince,
      frpcPid: this.frpcHandle?.pid ?? null,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastError: this.lastError,
      config: {
        autoStart: cfg?.autoStart ?? false,
        brokerUrl: cfg?.brokerUrl ?? 'https://frp.xopc.ai/api',
      },
    };
  }

  buildQr(gatewayPort: number, gatewayHost: string, gatewayToken: string): TunnelQrPayload {
    const persisted = loadTunnelState();
    const publicUrl = persisted?.publicUrl ?? null;
    if (!publicUrl) {
      return { qrPayload: '', publicUrl: null, lanUrl: null };
    }
    return buildMobileConnectQrPayload({
      publicUrl,
      lanUrl: resolveLanGatewayUrl(gatewayHost, gatewayPort),
      gatewayToken,
    });
  }

  async start(gatewayPort: number, gatewayToken: string): Promise<TunnelQrPayload> {
    const cfg = this.serviceConfig;
    if (!cfg) throw new Error('Tunnel service not configured');

    this.stopping = false;
    this.startContext = { gatewayPort, gatewayToken };
    this.state = 'connecting';
    this.lastError = null;
    this.emit('tunnel:connecting');

    const frpcBin = await ensureFrpcBinary();
    const persisted = loadTunnelState();
    const broker = new TunnelBrokerClient(resolveBrokerApiBase(cfg.brokerUrl));

    let registration: TunnelRegistration;
    try {
      registration = await this.resolveRegistration(broker, cfg, gatewayToken, persisted);
    } catch (err) {
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit('tunnel:error', this.lastError);
      throw err;
    }

    const state = persistedFromRegistration(registration);
    saveTunnelState(state);

    const configPath = writeFrpcConfig(registration, gatewayPort);
    await this.spawnAndWait(frpcBin, configPath, broker, state, registration.heartbeatIntervalMs);

    this.state = 'connected';
    this.connectedSince = new Date().toISOString();
    this.reconnectAttempt = 0;
    this.emit('tunnel:connected');

    return this.buildQr(gatewayPort, cfg.gatewayHost, gatewayToken);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearHeartbeat();
    if (this.frpcHandle) {
      await this.frpcHandle.kill();
      this.frpcHandle = null;
    }
    updateTunnelState({ enabled: false });
    this.state = 'disconnected';
    this.connectedSince = null;
    this.startContext = null;
    this.emit('tunnel:disconnected');
  }

  /**
   * Reuse Broker registration when possible so subdomain and URLs stay stable across stop/start.
   */
  private async resolveRegistration(
    broker: TunnelBrokerClient,
    cfg: TunnelServiceConfig,
    gatewayToken: string,
    persisted: PersistedTunnelState | null,
  ): Promise<TunnelRegistration> {
    if (canResumePersistedTunnel(persisted)) {
      try {
        await broker.heartbeat(persisted.tunnelId, persisted.tunnelToken);
        const resumed = registrationFromPersisted(persisted);
        if (resumed) {
          log.info(
            { tunnelId: persisted.tunnelId, subdomain: persisted.subdomain, phase: 'tunnel_resume' },
            'Resumed tunnel from persisted credentials',
          );
          return resumed;
        }
      } catch (err) {
        log.info(
          { err, tunnelId: persisted.tunnelId, phase: 'tunnel_resume' },
          'Persisted tunnel not resumable — registering again',
        );
      }
    }

    return broker.register({
      brokerUrl: resolveBrokerApiBase(cfg.brokerUrl),
      registrationSecret: cfg.registrationSecret,
      gatewayVersion: PACKAGE_VERSION,
      platform: platformLabel(),
      gatewayTokenHash: hashGatewayToken(gatewayToken),
      preferredSubdomain: persisted?.subdomain,
    });
  }

  private async spawnAndWait(
    frpcBin: string,
    configPath: string,
    broker: TunnelBrokerClient,
    state: PersistedTunnelState,
    heartbeatIntervalMs: number,
  ): Promise<void> {
    if (this.frpcHandle) {
      await this.frpcHandle.kill();
      this.frpcHandle = null;
    }

    const handle = spawnFrpcProcess(frpcBin, configPath);
    this.frpcHandle = handle;

    handle.onExit((code, signal) => {
      if (this.stopping) return;
      log.warn({ code, signal, pid: handle.pid }, 'frpc process exited');
      this.clearHeartbeat();
      this.frpcHandle = null;
      void this.scheduleReconnect(frpcBin, configPath, broker, state, heartbeatIntervalMs);
    });

    await handle.waitForLoginSuccess;
    this.startHeartbeat(broker, state, heartbeatIntervalMs);
  }

  private async scheduleReconnect(
    frpcBin: string,
    configPath: string,
    broker: TunnelBrokerClient,
    state: PersistedTunnelState,
    heartbeatIntervalMs: number,
  ): Promise<void> {
    if (this.stopping) return;
    const maxAttempts = 5;
    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > maxAttempts) {
      this.state = 'error';
      this.lastError = 'frpc reconnect failed after maximum attempts';
      log.error({ attempts: maxAttempts }, this.lastError);
      this.emit('tunnel:error', this.lastError);
      return;
    }

    this.state = 'reconnecting';
    const delayMs = Math.min(16_000, 1000 * 2 ** (this.reconnectAttempt - 1));
    log.info({ attempt: this.reconnectAttempt, delayMs }, 'Scheduling frpc reconnect');
    await new Promise((r) => setTimeout(r, delayMs));
    if (this.stopping) return;

    try {
      await this.spawnAndWait(frpcBin, configPath, broker, state, heartbeatIntervalMs);
      this.state = 'connected';
      this.reconnectAttempt = 0;
      this.emit('tunnel:connected');
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      void this.scheduleReconnect(frpcBin, configPath, broker, state, heartbeatIntervalMs);
    }
  }

  private startHeartbeat(
    broker: TunnelBrokerClient,
    state: PersistedTunnelState,
    intervalMs: number,
  ): void {
    this.clearHeartbeat();
    const tick = async () => {
      try {
        await broker.heartbeat(state.tunnelId, state.tunnelToken);
        this.lastHeartbeatAt = new Date().toISOString();
      } catch (err) {
        log.warn({ err, tunnelId: state.tunnelId }, 'Tunnel heartbeat failed');
        if (this.stopping) return;
        this.clearHeartbeat();
        const ctx = this.startContext;
        const cfg = this.serviceConfig;
        if (!ctx || !cfg) return;
        try {
          const registration = await broker.register({
            brokerUrl: resolveBrokerApiBase(cfg.brokerUrl),
            registrationSecret: cfg.registrationSecret,
            gatewayVersion: PACKAGE_VERSION,
            platform: platformLabel(),
            gatewayTokenHash: hashGatewayToken(ctx.gatewayToken),
            preferredSubdomain: state.subdomain,
          });
          const next = persistedFromRegistration(registration);
          saveTunnelState(next);
          const frpcBin = await ensureFrpcBinary();
          const configPath = writeFrpcConfig(registration, ctx.gatewayPort);
          await this.spawnAndWait(frpcBin, configPath, broker, next, registration.heartbeatIntervalMs);
        } catch (reErr) {
          this.lastError = reErr instanceof Error ? reErr.message : String(reErr);
          this.state = 'error';
          this.emit('tunnel:error', this.lastError);
        }
      }
    };
    void tick();
    this.heartbeatTimer = setInterval(() => void tick(), intervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
