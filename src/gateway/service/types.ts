import type { GatewayBindMode } from '../../config/schema.js';

export interface ServiceEvent {
  id: string;
  type: string;
  payload: unknown;
}

/** Phase-1 channel timings (init + optional defer plan + start + inline replay). Emitted as structured logs. */
export interface GatewayChannelStartupPhase1Metrics {
  deferChannelConnectUntilAfterHttp: boolean;
  /** From `gateway.channelConnectDeferMode` (default `auto`). */
  channelConnectDeferMode: 'auto' | 'off' | 'explicit';
  /** How `deferredChannelIds` were chosen: config off, explicit list, or plugin meta (+ skip). */
  channelConnectDeferSource: 'off' | 'explicit' | 'meta';
  deferredChannelIds: readonly string[];
  deferredChannelCount: number;
  channelInitMs: number;
  deferPlanMs: number;
  channelPhase1StartMs: number;
  /** Only when replay ran inside `start()`; null when deferred to `onHttpListening`. */
  replayOutboundMs: number | null;
  channelStartupPhase1TotalMs: number;
}

/** Phase-2 timings after HTTP listen (deferred `start()` + replay). */
export interface GatewayChannelStartupPhase2Metrics {
  channelConnectDeferMode: 'auto' | 'off' | 'explicit';
  channelConnectDeferSource: 'off' | 'explicit' | 'meta';
  deferredChannelIds: readonly string[];
  channelPhase2DeferredMs: number;
  replayOutboundMs: number;
  onHttpListeningTotalMs: number;
}

export interface GatewayServiceConfig {
  configPath?: string;
  /** CLI `--bind` override for startup security guards. */
  listenBind?: GatewayBindMode;
  listenCustomBindHost?: string;
  /** CLI `--port` override; used for CORS loopback defaults when it differs from config. */
  listenPort?: number;
  enableHotReload?: boolean;
  /**
   * When true (GatewayServer), outbound channel connects that declare
   * `meta.deferConnectUntilAfterListen` run in `onHttpListening()` after bind.
   * When false, deferred channels start at the end of `start()` (tests / embedded use).
   */
  deferChannelConnectUntilAfterHttp?: boolean;
}
