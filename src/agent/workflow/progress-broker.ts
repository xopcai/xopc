/**
 * WorkflowProgressBroker — the single seam that turns mid-run `workflow`
 * snapshots into IM messages (Telegram today, more channels later).
 *
 * Architecture:
 *
 *    pi-agent  ──tool_execution_update──▶  AgentEventHandler / SessionEventBus
 *                                                       │
 *                          attachTo(handler)            │
 *                                                       ▼
 *                                          WorkflowProgressBroker
 *                                                       │
 *                                  per-(sessionKey, toolCallId) state
 *                                                       │
 *                                   ┌───────────────────┼───────────────────┐
 *                                   ▼                   ▼                   ▼
 *                              Telegram cap         Feishu cap          WeChat cap
 *
 * Why broker + capability instead of "each channel subscribes the bus"?
 *   - DRY snapshot aggregation and key-event detection.
 *   - Per-channel throttling is enforced by the broker, so a slow / rate-limited
 *     channel can't block a fast one.
 *   - Adding a new channel = one capability + one register call. Broker code
 *     never grows.
 */

import type { AgentEvent } from '@earendil-works/pi-agent-core';

import { createLogger } from '../../utils/logger.js';
import type { Config } from '../../config/schema.js';

import type {
  ChannelProgressCapability,
  WorkflowProgressMode,
} from './channel-capability.js';
import { renderWorkflowText } from './snapshot.js';
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from './types.js';

const log = createLogger('workflow-progress-broker');

const WORKFLOW_TOOL_NAME = 'workflow';
const RENDER_MAX_AGENTS_PER_PHASE = 4;
const RENDER_MAX_LOGS = 2;

/** Per-channel resolved settings after applying config overrides on capability defaults. */
interface ChannelResolvedSettings {
  enabled: boolean;
  throttleMs: number;
  mode: WorkflowProgressMode;
}

/** Per-(sessionKey, toolCallId) progress state. */
interface RunState {
  /** Latest snapshot seen for this run. Always overwritten on update. */
  snapshot: WorkflowSnapshot;
  /** Previous snapshot used to detect "key events" (phase change, new errors). */
  prevSnapshot?: WorkflowSnapshot;
  /** Per-channel last-send bookkeeping. */
  perChannel: Map<string, ChannelRunState>;
}

interface ChannelRunState {
  /** Server timestamp of the last successful postProgress. */
  lastSentAt: number;
  /** Returned messageId of the last successful postProgress — drives edit mode. */
  lastMessageId?: string;
  /** Pending timer id (Node `setTimeout`) when a throttled flush is scheduled. */
  pendingTimer?: ReturnType<typeof setTimeout>;
  /** Inflight `postProgress` promise; we serialise per-(state, channel) to avoid race. */
  inflight?: Promise<void>;
}

export interface BrokerListenerHandle {
  /** Detach broker from the session bus and clear all in-flight state. */
  dispose(): void;
}

/**
 * Tiny façade onto the AgentEventHandler. We don't import the concrete class to
 * keep this module test-friendly — a stub listener pump is fine for unit tests.
 */
export interface SessionBusLike {
  registerListener(
    type: AgentEvent['type'] | 'all',
    listener: (event: AgentEvent, context: { sessionKey: string }) => void,
  ): () => void;
}

export class WorkflowProgressBroker {
  private subscribers: ChannelProgressCapability[] = [];
  private states = new Map<string, RunState>();
  /** Now() factory — overridable in tests for deterministic time. */
  private readonly now: () => number;
  /** Cached resolved settings per (channelId), invalidated on registration. */
  private resolved = new Map<string, ChannelResolvedSettings>();

  constructor(
    private readonly opts: {
      getConfig?: () => Config | undefined;
      now?: () => number;
    } = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  // ── Registration ────────────────────────────────────────────────────────────

  registerChannel(cap: ChannelProgressCapability): () => void {
    if (this.subscribers.some((s) => s.channelId === cap.channelId)) {
      log.warn({ channelId: cap.channelId }, 'channel capability already registered; replacing');
      this.subscribers = this.subscribers.filter((s) => s.channelId !== cap.channelId);
    }
    this.subscribers.push(cap);
    this.resolved.delete(cap.channelId);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== cap);
      this.resolved.delete(cap.channelId);
    };
  }

  attachTo(bus: SessionBusLike): BrokerListenerHandle {
    const offUpdate = bus.registerListener('tool_execution_update', (event, ctx) => {
      const e = event as Extract<AgentEvent, { type: 'tool_execution_update' }>;
      if (e.toolName !== WORKFLOW_TOOL_NAME) return;
      const snap = extractWorkflowSnapshot(e.partialResult);
      if (!snap) return;
      this.onUpdate(ctx.sessionKey, e.toolCallId, snap);
    });

    const offEnd = bus.registerListener('tool_execution_end', (event, ctx) => {
      const e = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
      if (e.toolName !== WORKFLOW_TOOL_NAME) return;
      // tool_end ships the final envelope in `result`; reach in for the
      // authoritative snapshot (durationMs / result / final counts).
      const snap = extractWorkflowSnapshot(e.result, { fromResultEnvelope: true });
      this.onEnd(ctx.sessionKey, e.toolCallId, snap);
    });

    return {
      dispose: () => {
        offUpdate();
        offEnd();
        this.disposeAllPending();
      },
    };
  }

  // ── Core state machine ──────────────────────────────────────────────────────

  /** Visible for tests — direct entry path bypassing the SessionBus glue. */
  onUpdate(sessionKey: string, toolCallId: string, snapshot: WorkflowSnapshot): void {
    const key = stateKey(sessionKey, toolCallId);
    const state = this.getOrCreateState(key, snapshot);
    state.prevSnapshot = state.snapshot;
    state.snapshot = snapshot;

    const isKey = isKeyEvent(state.prevSnapshot, snapshot);
    for (const cap of this.subscribers) {
      this.dispatchToChannel(state, sessionKey, cap, { isFinal: false, isKey });
    }
  }

  /** Visible for tests — direct entry path bypassing the SessionBus glue. */
  onEnd(sessionKey: string, toolCallId: string, snapshot: WorkflowSnapshot | null): void {
    const key = stateKey(sessionKey, toolCallId);
    const state = this.states.get(key);
    if (!state) return;
    if (snapshot) state.snapshot = snapshot;

    for (const cap of this.subscribers) {
      // Always flush the final message — bypass throttle and any pending timer.
      this.cancelPending(state, cap.channelId);
      this.dispatchToChannel(state, sessionKey, cap, { isFinal: true, isKey: true });
    }
    // State is GC'd lazily after a small grace period so any straggler
    // `update` event arriving after `end` is silently dropped (instead of
    // resurrecting the run).
    setTimeout(() => this.states.delete(key), 2_000);
  }

  // ── Dispatch + throttle ─────────────────────────────────────────────────────

  private dispatchToChannel(
    state: RunState,
    sessionKey: string,
    cap: ChannelProgressCapability,
    flags: { isFinal: boolean; isKey: boolean },
  ): void {
    const cfg = this.resolveChannelSettings(cap);
    if (!cfg.enabled) return;
    if (cfg.mode === 'final-only' && !flags.isFinal) return;

    const chState = this.getOrCreateChannelState(state, cap.channelId);

    // Key events and the final message bypass throttle.
    if (flags.isFinal || flags.isKey) {
      this.cancelPending(state, cap.channelId);
      void this.sendNow(state, sessionKey, cap, cfg, flags.isFinal);
      return;
    }

    const elapsed = this.now() - chState.lastSentAt;
    const wait = Math.max(0, cfg.throttleMs - elapsed);
    if (wait === 0) {
      void this.sendNow(state, sessionKey, cap, cfg, false);
      return;
    }
    if (chState.pendingTimer) return; // already scheduled; latest snapshot will be picked up
    chState.pendingTimer = setTimeout(() => {
      chState.pendingTimer = undefined;
      void this.sendNow(state, sessionKey, cap, cfg, false);
    }, wait);
  }

  private async sendNow(
    state: RunState,
    sessionKey: string,
    cap: ChannelProgressCapability,
    cfg: ChannelResolvedSettings,
    isFinal: boolean,
  ): Promise<void> {
    const chState = this.getOrCreateChannelState(state, cap.channelId);
    // Serialise per-channel sends so a slow editMessage call doesn't get
    // overtaken by a faster one and leave the bubble out of order.
    if (chState.inflight) await chState.inflight.catch(() => undefined);

    const text = renderWorkflowText(state.snapshot, isFinal, {
      maxAgentsPerPhase: RENDER_MAX_AGENTS_PER_PHASE,
      maxLogs: RENDER_MAX_LOGS,
      showResultPreviews: isFinal,
    });

    const previousMessageId = cfg.mode === 'edit' ? chState.lastMessageId : undefined;
    const task = cap
      .postProgress({ sessionKey, text, previousMessageId, isFinal, mode: cfg.mode })
      .then((r) => {
        chState.lastMessageId = r.messageId;
        chState.lastSentAt = this.now();
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, errorMessage: msg, channelId: cap.channelId, sessionKey },
          `workflow progress postProgress failed: ${msg}`,
        );
      })
      .finally(() => {
        chState.inflight = undefined;
      });

    chState.inflight = task;
    await task;
  }

  private cancelPending(state: RunState, channelId: string): void {
    const chState = state.perChannel.get(channelId);
    if (chState?.pendingTimer) {
      clearTimeout(chState.pendingTimer);
      chState.pendingTimer = undefined;
    }
  }

  private disposeAllPending(): void {
    for (const state of this.states.values()) {
      for (const ch of state.perChannel.values()) {
        if (ch.pendingTimer) clearTimeout(ch.pendingTimer);
      }
    }
    this.states.clear();
  }

  // ── State helpers ───────────────────────────────────────────────────────────

  private getOrCreateState(key: string, snapshot: WorkflowSnapshot): RunState {
    let state = this.states.get(key);
    if (!state) {
      state = { snapshot, perChannel: new Map() };
      this.states.set(key, state);
    }
    return state;
  }

  private getOrCreateChannelState(state: RunState, channelId: string): ChannelRunState {
    let ch = state.perChannel.get(channelId);
    if (!ch) {
      ch = { lastSentAt: 0 };
      state.perChannel.set(channelId, ch);
    }
    return ch;
  }

  /** Resolved (enabled / throttleMs / mode) for a channel, with config overrides. */
  private resolveChannelSettings(cap: ChannelProgressCapability): ChannelResolvedSettings {
    const cached = this.resolved.get(cap.channelId);
    if (cached) return cached;
    const override = readChannelConfig(this.opts.getConfig?.(), cap.channelId);
    const resolved: ChannelResolvedSettings = {
      enabled: override?.enabled ?? true,
      throttleMs: override?.throttleMs ?? cap.defaultThrottleMs,
      mode: override?.mode ?? cap.defaultMode,
    };
    this.resolved.set(cap.channelId, resolved);
    return resolved;
  }

  /** Drop any cached config so the next dispatch re-reads. Call after config reload. */
  invalidateConfigCache(): void {
    this.resolved.clear();
  }

  // ── Test introspection ──────────────────────────────────────────────────────

  /** @internal — for tests only. */
  _stateCount(): number {
    return this.states.size;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let singleton: WorkflowProgressBroker | null = null;

/**
 * Process-wide broker singleton. Channels register against this one; the
 * service wires it to the session bus during startup.
 */
export function getWorkflowProgressBroker(): WorkflowProgressBroker {
  if (!singleton) singleton = new WorkflowProgressBroker();
  return singleton;
}

/** Test-only — reset the singleton between cases. */
export function _resetWorkflowProgressBrokerForTests(): void {
  singleton = null;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function stateKey(sessionKey: string, toolCallId: string | undefined): string {
  return `${sessionKey}${toolCallId ?? ''}`;
}

/**
 * Compare two snapshots and decide whether the new one is "key" — i.e. worth
 * bypassing the per-channel throttle. Anything visible to the user as a
 * progress milestone qualifies; counts ticking by alone do not.
 */
function isKeyEvent(prev: WorkflowSnapshot | undefined, next: WorkflowSnapshot): boolean {
  if (!prev) return true; // first update of the run
  if (prev.currentPhase !== next.currentPhase) return true;
  if (next.errorCount > prev.errorCount) return true;
  if (next.skippedCount > prev.skippedCount) return true;
  // New phase row in the rollup (declared via `phase(...)` mid-run)
  if (prev.phases.length !== next.phases.length) return true;
  if (hasNewFailedAgent(prev.agents, next.agents)) return true;
  return false;
}

function hasNewFailedAgent(
  prev: WorkflowAgentSnapshot[],
  next: WorkflowAgentSnapshot[],
): boolean {
  const prevBad = new Set(
    prev.filter((a) => a.status === 'error' || a.status === 'skipped').map((a) => a.id),
  );
  for (const a of next) {
    if ((a.status === 'error' || a.status === 'skipped') && !prevBad.has(a.id)) return true;
  }
  return false;
}

/**
 * Pull a {@link WorkflowSnapshot} out of an AgentToolResult-shaped value.
 * Returns null when the payload is not snapshot-shaped (text-only updates,
 * non-workflow tools, etc.).
 *
 * `fromResultEnvelope = true` (used for `tool_end.result`) tolerates the
 * `{ content, details }` wrapper.
 */
function extractWorkflowSnapshot(
  payload: unknown,
  opts: { fromResultEnvelope?: boolean } = {},
): WorkflowSnapshot | null {
  if (!payload || typeof payload !== 'object') return null;
  const rec = payload as Record<string, unknown>;
  if (opts.fromResultEnvelope) {
    const details = rec.details;
    if (details && typeof details === 'object') return coerce(details);
    return null;
  }
  if ('details' in rec) {
    const details = rec.details;
    if (details && typeof details === 'object') return coerce(details);
    return null;
  }
  return coerce(rec);
}

function coerce(value: unknown): WorkflowSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.name !== 'string') return null;
  if (!Array.isArray(rec.agents)) return null;
  return value as WorkflowSnapshot;
}

function readChannelConfig(
  config: Config | undefined,
  channelId: string,
): { enabled?: boolean; throttleMs?: number; mode?: WorkflowProgressMode } | undefined {
  const channels = config?.channels as Record<string, unknown> | undefined;
  if (!channels) return undefined;
  const cfg = channels[channelId];
  if (!cfg || typeof cfg !== 'object') return undefined;
  const wf = (cfg as { workflowProgress?: unknown }).workflowProgress;
  if (!wf || typeof wf !== 'object') return undefined;
  return wf as { enabled?: boolean; throttleMs?: number; mode?: WorkflowProgressMode };
}
