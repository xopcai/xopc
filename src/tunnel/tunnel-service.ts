import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { PACKAGE_VERSION } from '../package-version.js';
import { createLogger } from '../utils/logger.js';
import { TunnelBrokerClient, TunnelBrokerError, resolveBrokerApiBase } from './broker-client.js';
import { clearFrpcPathForProcess, ensureFrpcBinary, publishFrpcPathForProcess } from './frpc-binary.js';
import { removeFrpcConfig, writeFrpcConfig } from './frpc-config.js';
import { type FrpcProcessHandle, spawnFrpcProcess } from './frpc-process.js';
import { TunnelRegistrationSecretError } from './env.js';
import {
  canResumePersistedTunnel,
  persistedFromRegistration,
  registrationFromPersisted,
} from './tunnel-persist.js';
import { clearTunnelState, loadTunnelState, saveTunnelState, updateTunnelState } from './tunnel-state.js';
import { logTunnelAudit } from './tunnel-audit.js';
import type { PersistedTunnelState, TunnelRegistration, TunnelStatus } from './tunnel-types.js';
import type { FrpcDownloadProgress, TunnelStartPhase, TunnelStartProgress } from './tunnel-types.js';

const log = createLogger('Tunnel');
const PUBLIC_PROBE_INTERVAL_MS = 10_000;
const PUBLIC_PROBE_FAILURE_LIMIT = 3;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function probePublicRoute(publicUrl: string): Promise<void> {
  const url = new URL('/api/health', publicUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Tunnel public route requires HTTPS');
  const response = await fetch(url, {
    redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) {
    await response.body?.cancel();
    throw new Error(`Tunnel public route did not reach the Gateway (HTTP ${response.status})`);
  }
  const health = await response.json() as { status?: string; ready?: boolean } | null;
  if (!(health?.status === 'ok' && health.ready === true) && !(health?.status === 'starting' && health.ready === false)) {
    throw new Error('Tunnel public route did not return Gateway health');
  }
}

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
  private publicProbeTimer: ReturnType<typeof setInterval> | null = null;
  private connectedSince: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private lastError: string | null = null;
  private state: TunnelStatus['state'] = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTask: Promise<void> | null = null;
  private lifecycle = 0;
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

  private startTask: Promise<void> | null = null;

  async start(gatewayPort: number, gatewayToken: string, options?: { recoverActiveLease?: boolean }): Promise<void> {
    if (this.startTask) return this.startTask;
    const task = this.startOnce(gatewayPort, gatewayToken, options).finally(() => {
      if (this.startTask === task) this.startTask = null;
    });
    this.startTask = task;
    return task;
  }

  private async startOnce(gatewayPort: number, gatewayToken: string, options?: { recoverActiveLease?: boolean }): Promise<void> {
    const cfg = this.serviceConfig;
    if (!cfg) throw new Error('Tunnel service not configured');
    if (options?.recoverActiveLease) await this.stop();

    this.stopping = false;
    const lifecycle = ++this.lifecycle;
    this.reconnectTask = null;
    this.clearHeartbeat();
    this.clearPublicProbe();
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
          if (lifecycle !== this.lifecycle) return;
          this.frpcDownload = progress;
          this.setStartPhase('preparing_frpc');
        },
      });
      this.frpcDownload = null;
      this.emit('tunnel:progress');
    } catch (err) {
      if (lifecycle !== this.lifecycle) throw err;
      this.frpcDownload = null;
      this.clearStartProgress();
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit('tunnel:error', this.lastError);
      throw err;
    }
    if (lifecycle !== this.lifecycle) throw new Error('Tunnel start superseded');
    publishFrpcPathForProcess(frpcBin);
    const persisted = loadTunnelState();
    const broker = new TunnelBrokerClient(resolveBrokerApiBase(cfg.brokerUrl));

    let registration: TunnelRegistration;
    try {
      this.setStartPhase('registering');
      registration = await this.resolveRegistration(broker, cfg, gatewayToken, persisted, options?.recoverActiveLease === true);
    } catch (err) {
      if (lifecycle !== this.lifecycle) throw err;
      this.clearStartProgress();
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit('tunnel:error', this.lastError);
      throw err;
    }

    const state = persistedFromRegistration(registration);
    if (lifecycle !== this.lifecycle) throw new Error('Tunnel start superseded');
    let configPath: string | undefined;
    try {
      saveTunnelState(state);
      this.setStartPhase('registering', { publicUrl: registration.publicUrl });
      configPath = writeFrpcConfig(registration, gatewayPort, '127.0.0.1');
      this.setStartPhase('starting_frpc', { publicUrl: registration.publicUrl });
      await this.spawnAndWait(frpcBin, configPath, broker, state, registration.heartbeatIntervalMs);
    } catch (err) {
      if (lifecycle !== this.lifecycle) throw err;
      this.clearStartProgress();
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit('tunnel:error', this.lastError);
      if (configPath && cfg.autoStart && persisted?.enabled && !options?.recoverActiveLease) {
        void this.scheduleReconnect(frpcBin, configPath, broker, state, registration.heartbeatIntervalMs);
      }
      throw err;
    }

    if (lifecycle !== this.lifecycle) throw new Error('Tunnel start superseded');
    this.markConnected();

    logTunnelAudit(
      'tunnel.start',
      {
        subdomain: registration.subdomain,
        publicUrl: registration.publicUrl,
        tunnelId: registration.tunnelId,
        gatewayTokenHash: hashGatewayToken(gatewayToken).slice(0, 12),
        recoveredActiveLease: options?.recoverActiveLease === true,
      },
      'Remote access tunnel started',
    );
  }

  private markConnected(): void {
    this.clearStartProgress();
    this.state = 'connected';
    this.connectedSince = new Date().toISOString();
    this.lastError = null;
    this.reconnectAttempt = 0;
    this.emit('tunnel:connected');
  }

  async stop(opts?: { release?: boolean }): Promise<{ released: boolean }> {
    const release = opts?.release === true;
    this.stopping = true;
    this.lifecycle++;
    this.reconnectTask = null;
    this.reconnectAttempt = 0;
    this.clearHeartbeat();
    this.clearPublicProbe();
    if (this.frpcHandle) {
      await this.frpcHandle.kill();
      this.frpcHandle = null;
    }
    clearFrpcPathForProcess();

    let released = false;
    const persisted = loadTunnelState();
    const cfg = this.serviceConfig;
    if (persisted) removeFrpcConfig(persisted.tunnelId);
    if (release && persisted && cfg) {
      const broker = new TunnelBrokerClient(resolveBrokerApiBase(cfg.brokerUrl));
      try {
        await broker.deregister(persisted.tunnelId, persisted.tunnelToken);
        released = true;
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.warn({ err, tunnelId: persisted.tunnelId, phase: 'tunnel_release' }, `Tunnel deregister failed: ${em}`);
      }
      if (released) {
        clearTunnelState();
        logTunnelAudit(
          'tunnel.release',
          { tunnelId: persisted.tunnelId, subdomain: persisted.subdomain },
          'Released tunnel registration and cleared local credentials',
        );
      } else {
        updateTunnelState({ enabled: false });
      }
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
    recoverActiveLease = false,
  ): Promise<TunnelRegistration> {
    if (!recoverActiveLease && canResumePersistedTunnel(persisted)) {
      const resumed = registrationFromPersisted(persisted)!;
      try {
        await broker.heartbeat(persisted.tunnelId, persisted.tunnelToken);
        log.info({ tunnelId: persisted.tunnelId, subdomain: persisted.subdomain }, 'Resumed tunnel from persisted credentials');
        return resumed;
      } catch (err) {
        if (!(err instanceof TunnelBrokerError) || ![401, 403, 410].includes(err.status)) {
          log.warn({ err, tunnelId: persisted.tunnelId }, 'Broker temporarily unavailable; trying the saved tunnel credentials');
          return resumed;
        }
        log.info(
          { err, tunnelId: persisted.tunnelId, phase: 'tunnel_resume' },
          'Persisted tunnel not resumable — registering again',
        );
      }
    }

    if (!cfg.registrationSecret) {
      throw new TunnelRegistrationSecretError(cfg.brokerUrl);
    }

    return (recoverActiveLease ? broker.recover.bind(broker) : broker.register.bind(broker))({
      brokerUrl: resolveBrokerApiBase(cfg.brokerUrl),
      registrationSecret: cfg.registrationSecret,
      gatewayVersion: PACKAGE_VERSION,
      platform: platformLabel(),
      recoveryToken: persisted?.tunnelToken,
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
    const lifecycle = this.lifecycle;
    this.clearPublicProbe();
    if (this.frpcHandle) {
      const previousHandle = this.frpcHandle;
      this.frpcHandle = null;
      await previousHandle.kill();
    }
    if (this.stopping || lifecycle !== this.lifecycle) throw new Error('Tunnel start superseded');

    const handle = spawnFrpcProcess(frpcBin, configPath);
    this.frpcHandle = handle;

    let loggedIn = false;
    handle.onExit((code, signal) => {
      // Replacing frpc intentionally kills the previous handle. Ignore that
      // stale exit instead of turning it into another reconnect attempt.
      if (this.stopping || lifecycle !== this.lifecycle || this.frpcHandle !== handle || !loggedIn) return;
      log.warn({ code, signal, pid: handle.pid }, 'frpc process exited');
      this.clearHeartbeat();
      this.clearPublicProbe();
      this.frpcHandle = null;
      void this.scheduleReconnect(frpcBin, configPath, broker, state, heartbeatIntervalMs);
    });

    try {
      await handle.waitForLoginSuccess;
      for (let attempt = 1; ; attempt++) {
        if (this.stopping || this.frpcHandle !== handle) throw new Error('Tunnel start superseded');
        try {
          await probePublicRoute(state.publicUrl);
          break;
        } catch (error) {
          if (attempt >= PUBLIC_PROBE_FAILURE_LIMIT) throw error;
          await delay(1000);
        }
      }
      if (this.stopping || this.frpcHandle !== handle) throw new Error('Tunnel start superseded');
      loggedIn = true;
      this.startHeartbeat(broker, state, heartbeatIntervalMs);
      this.monitorPublicRoute(handle, frpcBin, configPath, broker, state, heartbeatIntervalMs);
    } catch (error) {
      if (this.frpcHandle === handle) this.frpcHandle = null;
      await handle.kill();
      throw error;
    }
  }

  private monitorPublicRoute(
    handle: FrpcProcessHandle,
    frpcBin: string,
    configPath: string,
    broker: TunnelBrokerClient,
    state: PersistedTunnelState,
    heartbeatIntervalMs: number,
  ): void {
    const lifecycle = this.lifecycle;
    let failures = 0;
    let pending = false;
    this.publicProbeTimer = setInterval(async () => {
      if (pending || lifecycle !== this.lifecycle || this.frpcHandle !== handle) return;
      pending = true;
      try {
        await probePublicRoute(state.publicUrl);
        failures = 0;
      } catch (err) {
        if (lifecycle !== this.lifecycle || this.frpcHandle !== handle || ++failures < PUBLIC_PROBE_FAILURE_LIMIT) return;
        log.warn({ err, failures, tunnelId: state.tunnelId }, 'Public tunnel route is unavailable; reconnecting');
        this.lastError = err instanceof Error ? err.message : String(err);
        this.clearHeartbeat();
        this.clearPublicProbe();
        void this.scheduleReconnect(frpcBin, configPath, broker, state, heartbeatIntervalMs);
      } finally {
        pending = false;
      }
    }, PUBLIC_PROBE_INTERVAL_MS);
    this.publicProbeTimer.unref();
  }

  private clearPublicProbe(): void {
    if (this.publicProbeTimer) clearInterval(this.publicProbeTimer);
    this.publicProbeTimer = null;
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
    const lifecycle = this.lifecycle;
    while (!this.stopping && lifecycle === this.lifecycle) {
      this.reconnectAttempt += 1;
      if (this.reconnectAttempt > maxAttempts) {
        this.state = 'error';
        this.lastError = 'frpc reconnect failed after maximum attempts';
        log.error({ attempts: maxAttempts }, this.lastError);
        this.emit('tunnel:error', this.lastError);
        return;
      }

      this.state = 'reconnecting';
      this.connectedSince = null;
      this.setStartPhase('reconnecting_frpc', { publicUrl: state.publicUrl ?? null });
      const delayMs = Math.min(16_000, 1000 * 2 ** (this.reconnectAttempt - 1));
      log.info({ attempt: this.reconnectAttempt, delayMs }, 'Scheduling frpc reconnect');
      await delay(delayMs);
      if (this.stopping || lifecycle !== this.lifecycle) return;

      try {
        await this.spawnAndWait(frpcBin, configPath, broker, state, heartbeatIntervalMs);
        if (this.stopping || lifecycle !== this.lifecycle) return;
        this.markConnected();
        return;
      } catch (err) {
        if (this.stopping || lifecycle !== this.lifecycle) return;
        this.lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  private heartbeatGeneration = 0;

  private startHeartbeat(
    broker: TunnelBrokerClient,
    state: PersistedTunnelState,
    intervalMs: number,
  ): void {
    this.clearHeartbeat();
    const generation = this.heartbeatGeneration;
    let pending = false;
    const tick = async () => {
      if (pending || this.stopping || generation !== this.heartbeatGeneration) return;
      pending = true;
      try {
        await broker.heartbeat(state.tunnelId, state.tunnelToken);
        if (generation === this.heartbeatGeneration) this.lastHeartbeatAt = new Date().toISOString();
      } catch (err) {
        log.warn({ err, tunnelId: state.tunnelId }, 'Tunnel heartbeat failed');
        if (this.stopping || generation !== this.heartbeatGeneration) return;
        if (!(err instanceof TunnelBrokerError) || ![401, 403, 410].includes(err.status)) return;
        this.clearHeartbeat();
        if (err.status === 401 || err.status === 403) {
          await this.stop();
          this.lastError = 'TUNNEL_AUTH_REVOKED';
          this.state = 'error';
          this.emit('tunnel:error', this.lastError);
          return;
        }
        const renewalGeneration = this.heartbeatGeneration;
        const ctx = this.startContext;
        const cfg = this.serviceConfig;
        if (!ctx || !cfg) return;
        this.clearPublicProbe();
        this.state = 'reconnecting';
        this.connectedSince = null;
        this.setStartPhase('reconnecting_frpc', { publicUrl: state.publicUrl });
        try {
          if (!cfg.registrationSecret) {
            throw new TunnelRegistrationSecretError(cfg.brokerUrl);
          }
          const registration = await broker.register({
            brokerUrl: resolveBrokerApiBase(cfg.brokerUrl),
            registrationSecret: cfg.registrationSecret,
            gatewayVersion: PACKAGE_VERSION,
            platform: platformLabel(),
            recoveryToken: state.tunnelToken,
            preferredSubdomain: state.subdomain,
          });
          if (this.stopping || renewalGeneration !== this.heartbeatGeneration) return;
          const next = persistedFromRegistration(registration);
          removeFrpcConfig(state.tunnelId);
          saveTunnelState(next);
          const frpcBin = await ensureFrpcBinary();
          const configPath = writeFrpcConfig(registration, ctx.gatewayPort, '127.0.0.1');
          await this.spawnAndWait(frpcBin, configPath, broker, next, registration.heartbeatIntervalMs);
          this.markConnected();
        } catch (reErr) {
          if (this.stopping || renewalGeneration !== this.heartbeatGeneration) return;
          if (reErr instanceof TunnelBrokerError && [401, 403].includes(reErr.status)) await this.stop();
          this.lastError = reErr instanceof Error ? reErr.message : String(reErr);
          this.state = 'error';
          this.clearStartProgress();
          this.emit('tunnel:error', this.lastError);
        }
      } finally { pending = false; }
    };
    void tick();
    this.heartbeatTimer = setInterval(() => void tick(), intervalMs);
  }

  private clearHeartbeat(): void {
    this.heartbeatGeneration += 1;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
