import type { BrowserInteractiveInput, ManagedBrowserFrame, ManagedBrowserLiveHandle, ManagedBrowserViewport } from './drivers/browser-driver.js';
import { browserAssistance } from './assistance.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ManagedBrowserLive');

export const MANAGED_BROWSER_CONTROL_LEASE_MS = 10_000;
const SCREENCAST_IDLE_STOP_MS = 15_000;
const MAX_PENDING_INPUTS = 16;

export interface ManagedBrowserActor {
  actorKey: string;
  principalId: string;
  deviceName: string;
}

export interface ManagedBrowserLiveSnapshot {
  available: boolean;
  mode: 'managed';
  interactive: boolean;
  status: 'running' | 'needs_user' | 'human' | 'ended';
  browserSessionId?: string;
  assistanceId?: string;
  reason?: string;
  url: string;
  title: string;
  viewport: ManagedBrowserViewport;
  ownControl: boolean;
  controlOwner?: string;
  controlEpoch: number;
  privacyPaused: boolean;
}

export interface ManagedBrowserStoredFrame extends ManagedBrowserFrame {
  seq: number;
}

export type ManagedBrowserFrameResult =
  | { kind: 'frame'; frame: ManagedBrowserStoredFrame }
  | { kind: 'empty' }
  | { kind: 'privacy_paused' }
  | { kind: 'unavailable' };

export class ManagedBrowserLiveError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
    this.name = 'ManagedBrowserLiveError';
  }
}

interface ControlLease {
  actorKey: string;
  principalId: string;
  deviceName: string;
  epoch: number;
  leaseExpiresAt: number;
  lastSeq: number;
}

interface FrameWaiter {
  actorKey: string;
  resolve: (result: ManagedBrowserFrameResult) => void;
}

interface ManagedLiveEntry {
  conversationId: string;
  browserSessionId: string;
  handle: ManagedBrowserLiveHandle;
  url: string;
  title: string;
  controlEpoch: number;
  controlOwner?: ControlLease;
  screencastStop?: () => Promise<void>;
  screencastStarting?: Promise<void>;
  lastFramePollAt: number;
  frameSeq: number;
  latestFrame?: ManagedBrowserStoredFrame;
  frameWaiters: Set<FrameWaiter>;
  inputQueue: Promise<unknown>;
  pendingInputs: number;
  closed: boolean;
}

export interface ManagedBrowserLiveRuntimeDeps {
  isRunActive: (conversationId: string) => boolean;
  waitForIdle: (conversationId: string) => Promise<void>;
  pinSession: (conversationId: string) => void;
  unpinSession: (conversationId: string) => void;
  setHumanControlled?: (conversationId: string, active: boolean) => void;
  resumeBrowserAssistance: (conversationId: string, waitId: string) => void;
  onStatusChanged?: (conversationId: string, status: ManagedBrowserLiveSnapshot) => void;
}

export class ManagedBrowserLiveRuntime {
  private readonly entries = new Map<string, ManagedLiveEntry>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(private readonly deps: ManagedBrowserLiveRuntimeDeps) {
    this.sweepTimer = setInterval(() => this.sweep(), 1000);
    this.sweepTimer.unref?.();
  }

  close(): void {
    clearInterval(this.sweepTimer);
    for (const conversationId of [...this.entries.keys()]) {
      this.clearSource(conversationId);
    }
  }

  setSource(
    conversationId: string,
    source: { browserSessionId: string; handle: ManagedBrowserLiveHandle; url: string; title: string },
  ): void {
    const existing = this.entries.get(conversationId);
    if (existing && existing.browserSessionId === source.browserSessionId && !existing.closed) {
      existing.handle = source.handle;
      existing.url = source.url;
      existing.title = source.title;
      return;
    }
    if (existing) this.clearSource(conversationId);
    const entry: ManagedLiveEntry = {
      conversationId,
      browserSessionId: source.browserSessionId,
      handle: source.handle,
      url: source.url,
      title: source.title,
      controlEpoch: 0,
      lastFramePollAt: 0,
      frameSeq: 0,
      frameWaiters: new Set(),
      inputQueue: Promise.resolve(),
      pendingInputs: 0,
      closed: false,
    };
    this.entries.set(conversationId, entry);
  }

  clearSource(conversationId: string): void {
    const entry = this.entries.get(conversationId);
    if (!entry) return;
    entry.closed = true;
    this.entries.delete(conversationId);
    this.deps.setHumanControlled?.(conversationId, false);
    this.deps.unpinSession(conversationId);
    for (const waiter of entry.frameWaiters) {
      waiter.resolve({ kind: 'unavailable' });
    }
    entry.frameWaiters.clear();
    const stop = entry.screencastStop;
    entry.screencastStop = undefined;
    if (stop) void stop().catch(() => {});
  }

  isSessionPinned(conversationId: string): boolean {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.closed) return false;
    if (entry.controlOwner && entry.controlOwner.leaseExpiresAt > Date.now()) return true;
    const wait = browserAssistance(conversationId);
    return Boolean(wait && ['open', 'queued', 'resuming'].includes(wait.status));
  }

  isHumanControlled(conversationId: string): boolean {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.closed) return false;
    return Boolean(entry.controlOwner && entry.controlOwner.leaseExpiresAt > Date.now());
  }

  available(conversationId: string): boolean {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.closed) return false;
    return this.deps.isRunActive(conversationId) || this.isSessionPinned(conversationId);
  }

  status(conversationId: string, actorKey?: string): ManagedBrowserLiveSnapshot | undefined {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.closed || !this.available(conversationId)) return undefined;
    this.expireControlLeaseIfNeeded(entry);
    const wait = browserAssistance(conversationId);
    const openWait = wait && ['open', 'queued'].includes(wait.status) ? wait : undefined;
    const owner = entry.controlOwner;
    const ownControl = Boolean(owner && actorKey && owner.actorKey === actorKey);
    const privacyPaused = Boolean(owner && (!actorKey || owner.actorKey !== actorKey));
    const state: ManagedBrowserLiveSnapshot['status'] = owner
      ? 'human'
      : openWait
        ? 'needs_user'
        : 'running';
    return {
      available: true,
      mode: 'managed',
      interactive: true,
      status: state,
      browserSessionId: entry.browserSessionId,
      assistanceId: openWait?.id,
      reason: openWait?.checkpoint.reason,
      url: entry.handle.getUrl() || entry.url,
      title: entry.title,
      viewport: entry.handle.getViewport(),
      ownControl,
      controlOwner: owner?.deviceName,
      controlEpoch: entry.controlEpoch,
      privacyPaused,
    };
  }

  async takeover(conversationId: string, actor: ManagedBrowserActor): Promise<ManagedBrowserLiveSnapshot> {
    const entry = this.requireLiveEntry(conversationId);
    this.expireControlLeaseIfNeeded(entry);
    if (entry.controlOwner && entry.controlOwner.actorKey !== actor.actorKey) {
      throw new ManagedBrowserLiveError('BROWSER_CONTROL_BUSY', `${entry.controlOwner.deviceName} is currently controlling this browser.`, 409);
    }
    this.deps.pinSession(conversationId);
    await this.deps.waitForIdle(conversationId);
    if (entry.closed) {
      throw new ManagedBrowserLiveError('BROWSER_SESSION_CLOSED', 'The managed browser session has ended.', 404);
    }
    this.expireControlLeaseIfNeeded(entry);
    if (entry.controlOwner && entry.controlOwner.actorKey !== actor.actorKey) {
      throw new ManagedBrowserLiveError('BROWSER_CONTROL_BUSY', `${entry.controlOwner.deviceName} is currently controlling this browser.`, 409);
    }
    if (entry.controlOwner && entry.controlOwner.actorKey === actor.actorKey) {
      entry.controlOwner.leaseExpiresAt = Date.now() + MANAGED_BROWSER_CONTROL_LEASE_MS;
    } else {
      entry.controlEpoch += 1;
      entry.controlOwner = {
        actorKey: actor.actorKey,
        principalId: actor.principalId,
        deviceName: actor.deviceName,
        epoch: entry.controlEpoch,
        leaseExpiresAt: Date.now() + MANAGED_BROWSER_CONTROL_LEASE_MS,
        lastSeq: 0,
      };
      this.deps.setHumanControlled?.(conversationId, true);
      this.notifyPrivacyPauseToOthers(entry, actor.actorKey);
    }
    void this.ensureScreencast(entry).catch((err) => {
      log.warn({ err, conversationId }, 'Failed to start managed browser screencast during takeover');
    });
    const snapshot = this.status(conversationId, actor.actorKey)!;
    this.deps.onStatusChanged?.(conversationId, snapshot);
    return snapshot;
  }

  heartbeat(conversationId: string, actorKey: string, epoch: number): ManagedBrowserLiveSnapshot {
    const entry = this.requireLiveEntry(conversationId);
    this.expireControlLeaseIfNeeded(entry);
    if (!entry.controlOwner || entry.controlOwner.actorKey !== actorKey || entry.controlOwner.epoch !== epoch) {
      throw new ManagedBrowserLiveError('BROWSER_CONTROL_LOST', 'Browser control lease is no longer active.', 409);
    }
    entry.controlOwner.leaseExpiresAt = Date.now() + MANAGED_BROWSER_CONTROL_LEASE_MS;
    return this.status(conversationId, actorKey)!;
  }

  release(conversationId: string, actorKey: string, epoch?: number): ManagedBrowserLiveSnapshot | undefined {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.closed) return undefined;
    if (entry.controlOwner && entry.controlOwner.actorKey === actorKey
      && (epoch === undefined || entry.controlOwner.epoch === epoch)) {
      entry.controlOwner = undefined;
      this.deps.setHumanControlled?.(conversationId, false);
      if (!this.isSessionPinned(conversationId)) this.deps.unpinSession(conversationId);
      const snapshot = this.status(conversationId, actorKey);
      if (snapshot) this.deps.onStatusChanged?.(conversationId, snapshot);
      return snapshot;
    }
    return this.status(conversationId, actorKey);
  }

  handback(conversationId: string, actorKey: string, epoch?: number): ManagedBrowserLiveSnapshot {
    const entry = this.requireLiveEntry(conversationId);
    this.expireControlLeaseIfNeeded(entry);
    if (entry.controlOwner) {
      if (entry.controlOwner.actorKey !== actorKey || (epoch !== undefined && entry.controlOwner.epoch !== epoch)) {
        throw new ManagedBrowserLiveError('BROWSER_CONTROL_BUSY', `${entry.controlOwner.deviceName} is currently controlling this browser.`, 409);
      }
      entry.controlOwner = undefined;
    }
    this.deps.setHumanControlled?.(conversationId, false);
    entry.handle.invalidateRefs();
    const wait = browserAssistance(conversationId);
    if (wait && wait.status === 'open') {
      this.deps.resumeBrowserAssistance(conversationId, wait.id);
    }
    this.deps.unpinSession(conversationId);
    const snapshot = this.status(conversationId, actorKey) ?? {
      available: false,
      mode: 'managed',
      interactive: false,
      status: 'running',
      browserSessionId: entry.browserSessionId,
      url: entry.handle.getUrl() || entry.url,
      title: entry.title,
      viewport: entry.handle.getViewport(),
      ownControl: false,
      controlEpoch: entry.controlEpoch,
      privacyPaused: false,
    };
    this.deps.onStatusChanged?.(conversationId, snapshot);
    return snapshot;
  }

  async input(
    conversationId: string,
    actorKey: string,
    epoch: number,
    seq: number,
    event: BrowserInteractiveInput,
  ): Promise<void> {
    const entry = this.requireLiveEntry(conversationId);
    this.expireControlLeaseIfNeeded(entry);
    const owner = entry.controlOwner;
    if (!owner || owner.actorKey !== actorKey || owner.epoch !== epoch) {
      throw new ManagedBrowserLiveError('BROWSER_CONTROL_LOST', 'Browser control lease is no longer active.', 409);
    }
    if (!Number.isSafeInteger(seq) || seq <= owner.lastSeq) {
      throw new ManagedBrowserLiveError('BROWSER_INPUT_SEQUENCE', 'Stale input sequence.', 409);
    }
    if (entry.pendingInputs >= MAX_PENDING_INPUTS) {
      throw new ManagedBrowserLiveError('BROWSER_INPUT_BACKPRESSURE', 'Input queue is full.', 429);
    }
    owner.lastSeq = seq;
    owner.leaseExpiresAt = Date.now() + MANAGED_BROWSER_CONTROL_LEASE_MS;
    entry.pendingInputs += 1;
    const work = entry.inputQueue.catch(() => {}).then(async () => {
      if (entry.closed) throw new ManagedBrowserLiveError('BROWSER_SESSION_CLOSED', 'Browser session closed.', 404);
      this.expireControlLeaseIfNeeded(entry);
      if (!entry.controlOwner || entry.controlOwner.actorKey !== actorKey || entry.controlOwner.epoch !== epoch) {
        throw new ManagedBrowserLiveError('BROWSER_CONTROL_LOST', 'Browser control lease expired.', 409);
      }
      await entry.handle.dispatchInput(event);
    }).finally(() => {
      entry.pendingInputs = Math.max(0, entry.pendingInputs - 1);
    });
    entry.inputQueue = work;
    await work;
  }

  async waitForFrame(
    conversationId: string,
    actorKey: string,
    afterSeq: number,
    timeoutMs = 1200,
    signal?: AbortSignal,
  ): Promise<ManagedBrowserFrameResult> {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.closed || !this.available(conversationId)) return { kind: 'unavailable' };
    this.expireControlLeaseIfNeeded(entry);
    if (entry.controlOwner && entry.controlOwner.actorKey !== actorKey) {
      return { kind: 'privacy_paused' };
    }
    entry.lastFramePollAt = Date.now();
    await this.ensureScreencast(entry);
    if (entry.closed) return { kind: 'unavailable' };
    if (entry.controlOwner && entry.controlOwner.actorKey !== actorKey) {
      return { kind: 'privacy_paused' };
    }
    if (entry.latestFrame && entry.latestFrame.seq > afterSeq) {
      return { kind: 'frame', frame: entry.latestFrame };
    }
    return new Promise<ManagedBrowserFrameResult>((resolve) => {
      let settled = false;
      const done = (result: ManagedBrowserFrameResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        entry.frameWaiters.delete(waiter);
        resolve(result);
      };
      const waiter: FrameWaiter = { actorKey, resolve: done };
      const onAbort = () => done({ kind: 'empty' });
      const timer = setTimeout(() => done({ kind: 'empty' }), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.frameWaiters.add(waiter);
    });
  }

  private requireLiveEntry(conversationId: string): ManagedLiveEntry {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.closed || !this.available(conversationId)) {
      throw new ManagedBrowserLiveError('BROWSER_SESSION_UNAVAILABLE', 'No active managed browser session for this conversation.', 404);
    }
    return entry;
  }

  private async ensureScreencast(entry: ManagedLiveEntry): Promise<void> {
    if (entry.closed || entry.screencastStop) return;
    if (entry.screencastStarting) {
      await entry.screencastStarting;
      return;
    }
    const starting = entry.handle.startScreencast((frame) => {
      if (entry.closed) return;
      entry.frameSeq += 1;
      const stored: ManagedBrowserStoredFrame = { ...frame, seq: entry.frameSeq };
      entry.latestFrame = stored;
      const ownerKey = entry.controlOwner?.actorKey;
      for (const waiter of [...entry.frameWaiters]) {
        if (ownerKey && waiter.actorKey !== ownerKey) {
          waiter.resolve({ kind: 'privacy_paused' });
        } else {
          waiter.resolve({ kind: 'frame', frame: stored });
        }
      }
    }).then((stop) => {
      if (entry.closed) {
        void stop().catch(() => {});
        return;
      }
      entry.screencastStop = stop;
    }).finally(() => {
      if (entry.screencastStarting === starting) entry.screencastStarting = undefined;
    });
    entry.screencastStarting = starting;
    await starting;
  }

  private notifyPrivacyPauseToOthers(entry: ManagedLiveEntry, ownerActorKey: string): void {
    for (const waiter of [...entry.frameWaiters]) {
      if (waiter.actorKey !== ownerActorKey) {
        waiter.resolve({ kind: 'privacy_paused' });
      }
    }
  }

  private expireControlLeaseIfNeeded(entry: ManagedLiveEntry): void {
    if (entry.controlOwner && entry.controlOwner.leaseExpiresAt <= Date.now()) {
      entry.controlOwner = undefined;
      this.deps.setHumanControlled?.(entry.conversationId, false);
      if (!this.isSessionPinned(entry.conversationId)) {
        this.deps.unpinSession(entry.conversationId);
      }
      const snapshot = this.status(entry.conversationId);
      if (snapshot) this.deps.onStatusChanged?.(entry.conversationId, snapshot);
    }
  }

  sweep(): void {
    const now = Date.now();
    for (const entry of [...this.entries.values()]) {
      if (entry.closed) continue;
      this.expireControlLeaseIfNeeded(entry);
      if (entry.screencastStop && !entry.controlOwner && entry.frameWaiters.size === 0
        && now - entry.lastFramePollAt > SCREENCAST_IDLE_STOP_MS) {
        const stop = entry.screencastStop;
        entry.screencastStop = undefined;
        void stop().catch(() => {});
      }
    }
  }
}
