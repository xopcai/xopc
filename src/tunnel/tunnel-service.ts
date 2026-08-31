import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { PACKAGE_VERSION } from '../package-version.js';
import { createLogger } from '../utils/logger.js';
import { TunnelBrokerClient, resolveBrokerApiBase } from './broker-client.js';
import { clearFrpcPathForProcess, ensureFrpcBinary, publishFrpcPathForProcess } from './frpc-binary.js';
import { writeFrpcConfig } from './frpc-config.js';
import { type FrpcProcessHandle, spawnFrpcProcess } from './frpc-process.js';
import { buildMobileConnectQrPayload, resolveLanGatewayUrl } from './tunnel-qr.js';
import { createPairingSecret } from './pairing.js';
import { TunnelRegistrationSecretError } from './env.js';
import {
  canResumePersistedTunnel,
  persistedFromRegistration,
  registrationFromPersisted,
} from './tunnel-persist.js';
import { clearTunnelState, loadTunnelState, saveTunnelState, updateTunnelState } from './tunnel-state.js';
import { logTunnelAudit } from './tunnel-audit.js';
import type { PersistedTunnelState, TunnelQrPayload, TunnelRegistration, TunnelStatus } from './tunnel-types.js';
import type { FrpcDownloadProgress, TunnelStartPhase, TunnelStartProgress } from './tunnel-types.js';

const log = createLogger('Tunnel');

export type TunnelServiceConfig = {
  brokerUrl: string;
  registrationSecret?: string;
  autoStart: boolean;
  gatewayHost: string;
  frpSubdomainHost: string;
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
  private reconnectTask: Promise<void> | null = null;
  private stopping = false;
  private startContext: { gatewayPort: number; gatewayToken: string } | null = null;
  private frpcDownload: FrpcDownloadProgress | null = null;
  private startProgress: TunnelStartProgress | null = null;

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
      frpcDownload: this.frpcDownload,
      startProgress: this.startProgress,
      config: {
        autoStart: cfg?.autoStart ?? false,
        brokerUrl: cfg?.brokerUrl ?? 'https://frp.xopc.ai/api',
        transport: { tls: 'broker_terminated' },
      },
    };
  }

  private setStartPhase(phase: TunnelStartPhase, patch?: Partial<Pick<TunnelStartProgress, 'publicUrl'>>): void {
    const prev = this.startProgress;
    const samePhase = prev?.phase === phase;
    this.startProgress = {
      phase,
      startedAt: samePhase && prev ? prev.startedAt : new Date().toISOString(),
      publicUrl:
        patch?.publicUrl !== undefined
          ? patch.publicUrl
          : samePhase
            ? (prev?.publicUrl ?? null)
            : (prev?.publicUrl ?? null),
    };
    this.emit('tunnel:progress');
  }

  private clearStartProgress(): void {
    if (!this.startProgress) return;
    this.startProgress = null;
    this.emit('tunnel:progress');
  }

  async buildQr(gatewayPort: number, gatewayHost: string): Promise<TunnelQrPayload> {
    const persisted = loadTunnelState();
    const publicUrl = persisted?.publicUrl ?? null;
    if (!publicUrl) {
      return { qrPayload: '', publicUrl: null, lanUrl: null };
    }
    const { secret, expiresAt } = createPairingSecret();
    return buildMobileConnectQrPayload({
      publicUrl,
      lanUrl: resolveLanGatewayUrl(gatewayHost, gatewayPort),
      pairingSecret: secret,
      expiresAt: expiresAt.toISOString(),
    });
  }

  async start(gatewayPort: number, gatewayToken: string): Promise<TunnelQrPayload> {
    const cfg = this.serviceConfig;
    if (!cfg) throw new Error('Tunnel service not configured');

    this.stopping = false;
    this.startContext = { gatewayPort, gatewayToken };
    this.state = 'connecting';
    this.lastError = null;
    this.frpcDownload = null;
    this.startProgress = null;
    this.setStartPhase('preparing_frpc');
    this.emit('tunnel:connecting');

    let frpcBin: string;
    try {
      frpcBin = await ensureFrpcBinary({
        onProgress: (progress) => {
          this.frpcDownload = progress;
          this.setStartPhase('preparing_frpc');
        },
      });
      this.frpcDownload = null;
      this.emit('tunnel:progress');
    } catch (err) {
      this.frpcDownload = null;
      this.clearStartProgress();
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit('tunnel:error', this.lastError);
      throw err;
    }
    publishFrpcPathForProcess(frpcBin);
    const persisted = loadTunnelState();
    const broker = new TunnelBrokerClient(resolveBrokerApiBase(cfg.brokerUrl));

    let registration: TunnelRegistration;
    try {
      this.setStartPhase('registering');
      registration = await this.resolveRegistration(broker, cfg, gatewayToken, persisted);
    } catch (err) {
      this.clearStartProgress();
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit('tunnel:error', this.lastError);
      throw err;
    }

    const state = persistedFromRegistration(registration);
    saveTunnelState(state);
    this.setStartPhase('registering', { publicUrl: registration.publicUrl });

    try {
      const configPath = writeFrpcConfig(registration, gatewayPort, '127.0.0.1', 'http');
      this.setStartPhase('starting_frpc', { publicUrl: registration.publicUrl });
      await this.spawnAndWait(frpcBin, configPath, broker, state, registration.heartbeatIntervalMs);
    } catch (err) {
      this.clearStartProgress();
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit('tunnel:error', this.lastError);
      throw err;
    }

    this.clearStartProgress();
    this.state = 'connected';
    this.connectedSince = new Date().toISOString();
    this.reconnectAttempt = 0;
    this.emit('tunnel:connected');

    const qr = await this.buildQr(gatewayPort, cfg.gatewayHost);
    logTunnelAudit(
      'tunnel.start',
      {
        subdomain: registration.subdomain,
        publicUrl: registration.publicUrl,
        tunnelId: registration.tunnelId,
        gatewayTokenHash: hashGatewayToken(gatewayToken).slice(0, 12),
      },
      'Remote access tunnel started',
    );
    return qr;
  }

  async stop(opts?: { release?: boolean }): Promise<{ released: boolean }> {
    const release = opts?.release === true;
    this.stopping = true;
    this.clearHeartbeat();
    if (this.frpcHandle) {
      await this.frpcHandle.kill();
      this.frpcHandle = null;
    }
    clearFrpcPathForProcess();

    let released = false;
    const persisted = loadTunnelState();
    const cfg = this.serviceConfig;
    if (release && persisted && cfg) {
      const broker = new TunnelBrokerClient(resolveBrokerApiBase(cfg.brokerUrl));
      try {
        await broker.deregister(persisted.tunnelId, persisted.tunnelToken);
        released = true;
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.warn({ err, tunnelId: persisted.tunnelId, phase: 'tunnel_release' }, `Tunnel deregister failed: ${em}`);
      }
      clearTunnelState();
      logTunnelAudit(
        'tunnel.release',
        { tunnelId: persisted.tunnelId, subdomain: persisted.subdomain },
        'Released tunnel registration and cleared local credentials',
      );
    } else {
      updateTunnelState({ enabled: false });
      logTunnelAudit(
        'tunnel.stop',
        { tunnelId: persisted?.tunnelId ?? null, subdomain: persisted?.subdomain ?? null },
        'Remote access tunnel stopped (registration retained)',
      );
    }

    this.state = 'disconnected';
    this.connectedSince = null;
    this.startContext = null;
    this.clearStartProgress();
    this.emit('tunnel:disconnected');
    return { released };
  }

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

    if (!cfg.registrationSecret) {
      throw new TunnelRegistrationSecretError(cfg.brokerUrl);
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
      const previousHandle = this.frpcHandle;
      this.frpcHandle = null;
      await previousHandle.kill();
    }

    const handle = spawnFrpcProcess(frpcBin, configPath);
    this.frpcHandle = handle;

    handle.onExit((code, signal) => {
      // Replacing frpc intentionally kills the previous handle. Ignore that
      // stale exit instead of turning it into another reconnect attempt.
      if (this.stopping || this.frpcHandle !== handle) return;
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
    if (this.reconnectTask) return this.reconnectTask;

    const task = this.runReconnectLoop(frpcBin, configPath, broker, state, heartbeatIntervalMs)
      .finally(() => {
        if (this.reconnectTask === task) this.reconnectTask = null;
      });
    this.reconnectTask = task;
    return task;
  }

  private async runReconnectLoop(
    frpcBin: string,
    configPath: string,
    broker: TunnelBrokerClient,
    state: PersistedTunnelState,
    heartbeatIntervalMs: number,
  ): Promise<void> {
    const maxAttempts = 5;
    while (!this.stopping) {
      this.reconnectAttempt += 1;
      if (this.reconnectAttempt > maxAttempts) {
        this.state = 'error';
        this.lastError = 'frpc reconnect failed after maximum attempts';
        log.error({ attempts: maxAttempts }, this.lastError);
        this.emit('tunnel:error', this.lastError);
        return;
      }

      this.state = 'reconnecting';
      this.setStartPhase('reconnecting_frpc', { publicUrl: state.publicUrl ?? null });
      const delayMs = Math.min(16_000, 1000 * 2 ** (this.reconnectAttempt - 1));
      log.info({ attempt: this.reconnectAttempt, delayMs }, 'Scheduling frpc reconnect');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (this.stopping) return;

      try {
        await this.spawnAndWait(frpcBin, configPath, broker, state, heartbeatIntervalMs);
        this.clearStartProgress();
        this.state = 'connected';
        this.reconnectAttempt = 0;
        this.emit('tunnel:connected');
        return;
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
      }
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
          if (!cfg.registrationSecret) {
            throw new TunnelRegistrationSecretError(cfg.brokerUrl);
          }
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
          const configPath = writeFrpcConfig(registration, ctx.gatewayPort, '127.0.0.1', 'http');
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
