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
import {
  canResumePersistedTunnel,
  persistedFromRegistration,
  registrationFromPersisted,
} from './tunnel-persist.js';
import { clearTunnelState, loadTunnelState, saveTunnelState, updateTunnelState } from './tunnel-state.js';
import { logTunnelAudit } from './tunnel-audit.js';
import type { PersistedTunnelState, TunnelQrPayload, TunnelRegistration, TunnelStatus } from './tunnel-types.js';
import type {
  FrpcDownloadProgress,
  TunnelAcmeProgressStep,
  TunnelStartPhase,
  TunnelStartProgress,
} from './tunnel-types.js';
import type { ResolvedTunnelE2eConfig } from './tunnel-e2e-config.js';
import { getCertStatusSummary } from './acme-cert-store.js';
import type { AcmeConfig } from './acme-client.js';
import { startTunnelTlsServer, stopTunnelTlsServer } from './tls-server.js';

const log = createLogger('Tunnel');

export type TunnelServiceConfig = {
  brokerUrl: string;
  registrationSecret: string;
  autoStart: boolean;
  gatewayHost: string;
  e2e: ResolvedTunnelE2eConfig;
  frpSubdomainHost: string;
  gatewayFetch?: typeof fetch;
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
  private pendingGatewayFetch: typeof fetch | undefined;
  private frpcHandle: FrpcProcessHandle | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectedSince: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private lastError: string | null = null;
  private state: TunnelStatus['state'] = 'disconnected';
  private reconnectAttempt = 0;
  private stopping = false;
  private startContext: { gatewayPort: number; gatewayToken: string } | null = null;
  private frpcDownload: FrpcDownloadProgress | null = null;
  private startProgress: TunnelStartProgress | null = null;

  configure(cfg: TunnelServiceConfig): void {
    this.serviceConfig = {
      ...cfg,
      gatewayFetch: cfg.gatewayFetch ?? this.pendingGatewayFetch ?? this.serviceConfig?.gatewayFetch,
    };
  }

  setGatewayFetch(fetchFn: typeof fetch): void {
    this.pendingGatewayFetch = fetchFn;
    if (this.serviceConfig) {
      this.serviceConfig.gatewayFetch = fetchFn;
    }
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
        e2e: {
          enabled: cfg?.e2e.enabled ?? true,
          tlsPort: cfg?.e2e.tlsPort ?? 18791,
          staging: cfg?.e2e.staging ?? false,
        },
      },
      cert: getCertStatusSummary(),
    };
  }

  private setStartPhase(
    phase: TunnelStartPhase,
    patch?: Partial<Pick<TunnelStartProgress, 'acmeStep' | 'publicUrl'>>,
  ): void {
    const prev = this.startProgress;
    const samePhase = prev?.phase === phase;
    this.startProgress = {
      phase,
      startedAt: samePhase && prev ? prev.startedAt : new Date().toISOString(),
      acmeStep:
        patch?.acmeStep !== undefined
          ? patch.acmeStep
          : samePhase
            ? (prev?.acmeStep ?? null)
            : null,
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

  buildQr(gatewayPort: number, gatewayHost: string): TunnelQrPayload {
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
      const { frpcLocalPort, frpcMode } = await this.prepareFrpcTarget(
        broker,
        registration,
        cfg,
        gatewayPort,
      );
      const configPath = writeFrpcConfig(registration, frpcLocalPort, '127.0.0.1', frpcMode);
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

    const qr = this.buildQr(gatewayPort, cfg.gatewayHost);
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
    stopTunnelTlsServer();
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
    this.setStartPhase('reconnecting_frpc', { publicUrl: state.publicUrl ?? null });
    const delayMs = Math.min(16_000, 1000 * 2 ** (this.reconnectAttempt - 1));
    log.info({ attempt: this.reconnectAttempt, delayMs }, 'Scheduling frpc reconnect');
    await new Promise((r) => setTimeout(r, delayMs));
    if (this.stopping) return;

    try {
      await this.spawnAndWait(frpcBin, configPath, broker, state, heartbeatIntervalMs);
      this.clearStartProgress();
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
          const { frpcLocalPort, frpcMode } = await this.prepareFrpcTarget(
            broker,
            registration,
            cfg,
            ctx.gatewayPort,
          );
          const configPath = writeFrpcConfig(registration, frpcLocalPort, '127.0.0.1', frpcMode);
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

  private async prepareFrpcTarget(
    broker: TunnelBrokerClient,
    registration: TunnelRegistration,
    cfg: TunnelServiceConfig,
    gatewayPort: number,
  ): Promise<{ frpcLocalPort: number; frpcMode: 'http' | 'https' }> {
    if (!cfg.e2e.enabled) {
      return { frpcLocalPort: gatewayPort, frpcMode: 'http' };
    }

    this.setStartPhase('provisioning_tls', { publicUrl: registration.publicUrl });

    const acmeConfig: AcmeConfig = {
      broker,
      tunnelId: registration.tunnelId,
      tunnelToken: registration.tunnelToken,
      subdomain: registration.subdomain,
      frpSubdomainHost: cfg.frpSubdomainHost,
      staging: cfg.e2e.staging,
      onProgress: (step: TunnelAcmeProgressStep) => {
        this.setStartPhase('provisioning_tls', {
          publicUrl: registration.publicUrl,
          acmeStep: step,
        });
      },
    };

    await startTunnelTlsServer({
      tlsPort: cfg.e2e.tlsPort,
      gatewayPort,
      acmeConfig,
      fetch: cfg.gatewayFetch,
    });

    return { frpcLocalPort: cfg.e2e.tlsPort, frpcMode: 'https' };
  }
}
