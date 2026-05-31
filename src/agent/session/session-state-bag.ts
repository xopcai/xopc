/**
 * SessionStateBag — typed container for the per-session state previously held
 * as private fields on `AgentService` (six `Map<sessionKey, …>` instances with
 * no shared cleanup path).
 *
 * Goals:
 * - Single `disposeSession(sessionKey)` entry that clears every slot for a key
 *   (and runs the event unsubscriber, which was easy to forget previously).
 * - Optional TTL sweep for slots whose lifecycle is not bound to an explicit
 *   register/unregister pair, so long-running Gateways do not accumulate stale
 *   per-session entries from disconnected webchat clients or finished turns.
 * - Hard upper bound for the same TTL'd slots to bound worst-case memory.
 *
 * Slots whose lifetime is fully owned by explicit lifecycle calls
 * (`inboundTurnDepth`, `directStreamOutcome`, `embeddedStreamText`,
 * `sessionEventUnsubscribers`) are still cleared via `disposeSession`, but they
 * are NOT subject to TTL — sweeping them would race with their owners.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('SessionStateBag');

export type WebchatSsePublisher = (event: { type: string; [key: string]: unknown }) => void;

export interface PersistentGoalStreamOutcome {
  skipPersistentGoalPostTurn: boolean;
}

export interface SessionStateBagOptions {
  /** Idle TTL for TTL-managed slots. Defaults to 1 hour. Set to 0 to disable sweeping. */
  ttlMs?: number;
  /** Sweep cadence. Defaults to 10 minutes. */
  sweepIntervalMs?: number;
  /** Hard upper bound on entries for TTL-managed slots. Defaults to 5000. */
  maxEntries?: number;
  /** Inject a clock for tests. */
  now?: () => number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5_000;

type Touched<V> = { value: V; touchedAt: number };

export class SessionStateBag {
  /** Webchat SSE publisher (register/unregister + TTL fallback). */
  private readonly webchatPublishers = new Map<string, Touched<WebchatSsePublisher>>();
  /** Last assistant plain text (TTL + LRU). */
  private readonly lastAssistantText = new Map<string, Touched<string>>();

  /** Stream text for the in-flight embedded turn (managed by turn). */
  private readonly embeddedStreamText = new Map<string, string>();
  /** Persistent-goal stream outcome (take-and-delete). */
  private readonly directStreamOutcome = new Map<string, PersistentGoalStreamOutcome>();
  /** Concurrent inbound turn depth (counter). */
  private readonly inboundTurnDepth = new Map<string, number>();
  /** Agent-event subscription tear-downs (run on dispose). */
  private readonly sessionEventUnsubscribers = new Map<string, () => void>();

  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly sweepTimer: ReturnType<typeof setInterval> | null;

  constructor(opts: SessionStateBagOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = opts.now ?? Date.now;

    const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (this.ttlMs > 0 && sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweepStaleEntries(), sweepIntervalMs);
      this.sweepTimer.unref?.();
    } else {
      this.sweepTimer = null;
    }
  }

  // ── Webchat publishers ──────────────────────────────────────────────────

  registerWebchatPublisher(sessionKey: string, publisher: WebchatSsePublisher): void {
    this.webchatPublishers.set(sessionKey, { value: publisher, touchedAt: this.now() });
    this.enforceCap(this.webchatPublishers, 'webchatPublishers');
  }

  unregisterWebchatPublisher(sessionKey: string): void {
    this.webchatPublishers.delete(sessionKey);
  }

  getWebchatPublisher(sessionKey: string): WebchatSsePublisher | undefined {
    const entry = this.webchatPublishers.get(sessionKey);
    if (!entry) return undefined;
    entry.touchedAt = this.now();
    return entry.value;
  }

  // ── Last assistant plain text ───────────────────────────────────────────

  setLastAssistantText(sessionKey: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.lastAssistantText.set(sessionKey, { value: trimmed, touchedAt: this.now() });
    this.enforceCap(this.lastAssistantText, 'lastAssistantText');
  }

  getLastAssistantText(sessionKey: string): string | undefined {
    const entry = this.lastAssistantText.get(sessionKey);
    if (!entry) return undefined;
    entry.touchedAt = this.now();
    return entry.value;
  }

  // ── Embedded stream text (turn-scoped) ──────────────────────────────────

  appendEmbeddedStreamText(sessionKey: string, chunk: string): string {
    const prev = this.embeddedStreamText.get(sessionKey) ?? '';
    const next = prev + chunk;
    this.embeddedStreamText.set(sessionKey, next);
    return next;
  }

  clearEmbeddedStreamText(sessionKey: string): void {
    this.embeddedStreamText.delete(sessionKey);
  }

  // ── Persistent-goal stream outcome (take-and-delete) ────────────────────

  recordPersistentGoalStreamOutcome(sessionKey: string, outcome: PersistentGoalStreamOutcome): void {
    this.directStreamOutcome.set(sessionKey, outcome);
  }

  takePersistentGoalStreamOutcome(sessionKey: string): PersistentGoalStreamOutcome | undefined {
    const v = this.directStreamOutcome.get(sessionKey);
    this.directStreamOutcome.delete(sessionKey);
    return v;
  }

  // ── Inbound turn depth (counter) ────────────────────────────────────────

  beginInboundTurn(sessionKey: string): void {
    this.inboundTurnDepth.set(sessionKey, (this.inboundTurnDepth.get(sessionKey) ?? 0) + 1);
  }

  endInboundTurn(sessionKey: string): void {
    const next = (this.inboundTurnDepth.get(sessionKey) ?? 1) - 1;
    if (next <= 0) {
      this.inboundTurnDepth.delete(sessionKey);
    } else {
      this.inboundTurnDepth.set(sessionKey, next);
    }
  }

  getInboundTurnDepth(sessionKey: string): number {
    return this.inboundTurnDepth.get(sessionKey) ?? 0;
  }

  // ── Session event unsubscribers ─────────────────────────────────────────

  setSessionEventUnsubscriber(sessionKey: string, unsubscribe: () => void): void {
    const previous = this.sessionEventUnsubscribers.get(sessionKey);
    if (previous) {
      try {
        previous();
      } catch (err) {
        log.warn({ err, sessionKey }, 'Previous session-event unsubscribe threw');
      }
    }
    this.sessionEventUnsubscribers.set(sessionKey, unsubscribe);
  }

  hasSessionEventUnsubscriber(sessionKey: string): boolean {
    return this.sessionEventUnsubscribers.has(sessionKey);
  }

  // ── Lifecycle / cleanup ─────────────────────────────────────────────────

  /** Clear every slot for `sessionKey`, invoking the unsubscriber if registered. */
  disposeSession(sessionKey: string): void {
    const unsub = this.sessionEventUnsubscribers.get(sessionKey);
    if (unsub) {
      try {
        unsub();
      } catch (err) {
        log.warn({ err, sessionKey }, 'Session event unsubscribe threw during dispose');
      }
      this.sessionEventUnsubscribers.delete(sessionKey);
    }

    this.webchatPublishers.delete(sessionKey);
    this.lastAssistantText.delete(sessionKey);
    this.embeddedStreamText.delete(sessionKey);
    this.directStreamOutcome.delete(sessionKey);
    this.inboundTurnDepth.delete(sessionKey);
  }

  /** Tear down every session (process stop / hot reload). */
  disposeAll(): void {
    for (const [sessionKey, unsub] of this.sessionEventUnsubscribers) {
      try {
        unsub();
      } catch (err) {
        log.warn({ err, sessionKey }, 'Session event unsubscribe threw during disposeAll');
      }
    }
    this.sessionEventUnsubscribers.clear();
    this.webchatPublishers.clear();
    this.lastAssistantText.clear();
    this.embeddedStreamText.clear();
    this.directStreamOutcome.clear();
    this.inboundTurnDepth.clear();

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  /** Test helper. */
  size(): {
    webchatPublishers: number;
    lastAssistantText: number;
    embeddedStreamText: number;
    directStreamOutcome: number;
    inboundTurnDepth: number;
    sessionEventUnsubscribers: number;
  } {
    return {
      webchatPublishers: this.webchatPublishers.size,
      lastAssistantText: this.lastAssistantText.size,
      embeddedStreamText: this.embeddedStreamText.size,
      directStreamOutcome: this.directStreamOutcome.size,
      inboundTurnDepth: this.inboundTurnDepth.size,
      sessionEventUnsubscribers: this.sessionEventUnsubscribers.size,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private sweepStaleEntries(): void {
    const cutoff = this.now() - this.ttlMs;
    let removed = 0;
    for (const [k, entry] of this.webchatPublishers) {
      if (entry.touchedAt < cutoff) {
        this.webchatPublishers.delete(k);
        removed += 1;
      }
    }
    for (const [k, entry] of this.lastAssistantText) {
      if (entry.touchedAt < cutoff) {
        this.lastAssistantText.delete(k);
        removed += 1;
      }
    }
    if (removed > 0) {
      log.debug({ removed, ttlMs: this.ttlMs }, 'SessionStateBag TTL sweep');
    }
  }

  private enforceCap<V>(map: Map<string, Touched<V>>, slotName: string): void {
    if (map.size <= this.maxEntries) {
      return;
    }
    // Evict oldest entries (LRU on touchedAt) until under cap.
    const sorted = [...map.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    let evict = map.size - this.maxEntries;
    while (evict > 0 && sorted.length > 0) {
      const oldest = sorted.shift()!;
      map.delete(oldest[0]);
      evict -= 1;
    }
    log.warn(
      { slot: slotName, maxEntries: this.maxEntries },
      `SessionStateBag slot exceeded cap; evicted oldest entries`,
    );
  }
}
