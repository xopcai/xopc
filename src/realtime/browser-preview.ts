import { randomUUID } from 'node:crypto';

import {
  BROWSER_PREVIEW_LEASE_MS,
  BROWSER_PREVIEW_REQUEST_MS,
  type BrowserPreviewClientMessage,
  type BrowserPreviewServerMessage,
} from '@xopcai/realtime-protocol';

import { browserPreviewIce } from './browser-preview-ice.js';

export interface BrowserPreviewTarget {
  conversationId: string;
  runId: string;
  endpointId: string;
  browserSessionId: string;
  tabId: number;
  origin: string;
}

type Peer = {
  viewer?: string;
  principalId?: string;
  source?: { endpointId: string; isCurrent: () => boolean };
  isActive: () => boolean;
  send: (message: BrowserPreviewServerMessage) => void;
};

type Watching = {
  requestId: string;
  target: BrowserPreviewTarget;
  source: Peer;
  viewer: Peer;
  expiresAt: number;
  snapshotToken?: string;
  snapshot?: { bytes: Uint8Array; at: number; version: number };
  snapshotVersion?: number;
  restarted?: true;
  phase: 'requested' | 'accepted' | 'offered' | 'answered';
};

type CloseReason = Extract<BrowserPreviewServerMessage, { type: 'closed' }>['reason'];

export class BrowserPreviewRuntime {
  private readonly targets = new Map<string, BrowserPreviewTarget>();
  private readonly sources = new Map<string, Peer>();
  private readonly watches = new Map<string, Watching>();

  constructor(private readonly activeRun: (conversationId: string) => string | undefined) {}

  setTarget(target: BrowserPreviewTarget): void {
    if (this.activeRun(target.conversationId) !== target.runId) return;
    const previous = this.targets.get(target.conversationId);
    if (previous && previous.runId === target.runId && previous.browserSessionId === target.browserSessionId
      && previous.endpointId === target.endpointId && previous.tabId === target.tabId && previous.origin === target.origin) return;
    this.removeTarget(target.conversationId);
    this.sweep();
    if (this.targets.size < 100) this.targets.set(target.conversationId, target);
  }

  clearTarget(conversationId: string, runId: string): void {
    if (this.targets.get(conversationId)?.runId === runId) this.removeTarget(conversationId);
  }

  private removeTarget(conversationId: string): void {
    this.targets.delete(conversationId);
    for (const watch of this.watches.values()) {
      if (watch.target.conversationId === conversationId) this.closeWatch(watch, 'ended');
    }
  }

  available(conversationId: string): boolean {
    const target = this.targets.get(conversationId);
    const source = target && this.sources.get(target.endpointId);
    return Boolean(target && source?.isActive() && source.source?.isCurrent()
      && this.activeRun(conversationId) === target.runId);
  }

  register(peer: Peer): () => void {
    if (peer.source) this.sources.set(peer.source.endpointId, peer);
    return () => {
      if (peer.source && this.sources.get(peer.source.endpointId) === peer) this.sources.delete(peer.source.endpointId);
      for (const watch of this.watches.values()) {
        if (watch.source === peer || watch.viewer === peer) this.closeWatch(watch, 'ended');
      }
    };
  }

  receive(peer: Peer, message: BrowserPreviewClientMessage): void {
    if (message.type === 'view') {
      if (!peer.viewer || !peer.isActive()) return;
      this.request(peer, message.requestId, message.conversationId);
      return;
    }
    const watch = this.watches.get(message.requestId);
    if (!watch || (peer !== watch.source && peer !== watch.viewer)) return;
    if (!this.valid(watch)) {
      this.closeWatch(watch, 'expired');
      return;
    }
    if (message.type === 'close') {
      this.closeWatch(watch, 'ended');
    } else if (message.type === 'accept' && peer === watch.source && watch.phase === 'requested') {
      watch.phase = 'accepted';
      watch.expiresAt = Date.now() + BROWSER_PREVIEW_LEASE_MS;
      watch.source.send({ type: 'accepted', requestId: watch.requestId, ice: browserPreviewIce() });
      watch.viewer.send({ type: 'accepted', requestId: watch.requestId, ice: browserPreviewIce() });
      watch.source.send({ type: 'lease', requestId: watch.requestId });
    } else if (message.type === 'renew' && peer === watch.viewer && watch.phase !== 'requested') {
      watch.expiresAt = Date.now() + BROWSER_PREVIEW_LEASE_MS;
      watch.source.send({ type: 'lease', requestId: watch.requestId });
      watch.viewer.send({ type: 'lease', requestId: watch.requestId });
    } else if (message.type === 'quality' && peer === watch.viewer && watch.phase !== 'requested') {
      if (message.quality === 'snapshot') watch.snapshotToken ??= randomUUID();
      const token = message.quality === 'snapshot' ? watch.snapshotToken : undefined;
      if (!token) { watch.snapshotToken = undefined; watch.snapshot = undefined; }
      const quality = { type: 'quality', requestId: watch.requestId, quality: message.quality,
        ...(token ? { snapshotToken: token } : {}) } as const;
      watch.source.send(quality);
      watch.viewer.send(quality);
    } else if (message.type === 'signal') {
      const signal = message.signal;
      if (signal.type === 'offer' && peer === watch.viewer && (watch.phase === 'accepted' || watch.phase === 'answered' && !watch.restarted)) {
        if (watch.phase === 'answered') watch.restarted = true;
        watch.phase = 'offered';
      }
      else if (signal.type === 'answer' && peer === watch.source && watch.phase === 'offered') watch.phase = 'answered';
      else if (signal.type !== 'candidate' || watch.phase === 'requested' || watch.phase === 'accepted') return;
      const receiver = peer === watch.viewer ? watch.source : watch.viewer;
      receiver.send({ type: 'signal', requestId: watch.requestId, signal });
    }
  }

  private request(viewer: Peer, requestId: string, conversationId: string): void {
    this.sweep();
    const target = this.targets.get(conversationId);
    const source = target && this.sources.get(target.endpointId);
    if (!target || !source || !this.available(conversationId)) {
      viewer.send({ type: 'closed', requestId, reason: 'unavailable' });
      return;
    }
    const current = [...this.watches.values()];
    if (this.watches.has(requestId)
      || current.some(watch => watch.viewer === viewer || watch.source === source && watch.target !== target)
      || current.filter(watch => watch.source === source).length >= 2) {
      viewer.send({ type: 'closed', requestId, reason: 'busy' });
      return;
    }
    const watch: Watching = { requestId, target, source, viewer, phase: 'requested', expiresAt: Date.now() + BROWSER_PREVIEW_REQUEST_MS };
    this.watches.set(requestId, watch);
    viewer.send({ type: 'waiting', requestId, origin: target.origin });
    source.send({ type: 'requested', requestId, conversationId, origin: target.origin, tabId: target.tabId,
      browserSessionId: target.browserSessionId, viewer: viewer.viewer! });
  }

  publishSnapshot(requestId: string, principalId: string, token: string, bytes: Uint8Array): boolean {
    const watch = this.watches.get(requestId);
    const now = Date.now();
    if (!watch || watch.source.principalId !== principalId || watch.snapshotToken !== token || !this.valid(watch)
      || bytes.length > 80 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
    if (watch.snapshot && now - watch.snapshot.at < 400) return true;
    watch.snapshotVersion = (watch.snapshotVersion ?? 0) + 1;
    watch.snapshot = { bytes, at: now, version: watch.snapshotVersion };
    return true;
  }

  readSnapshot(requestId: string, principalId: string, token: string, after: number) {
    const watch = this.watches.get(requestId);
    if (!watch || watch.viewer.principalId !== principalId || watch.snapshotToken !== token || !this.valid(watch)) return undefined;
    const snapshot = watch.snapshot;
    return { snapshot: snapshot && Date.now() - snapshot.at < 2000 && snapshot.version > after ? snapshot : undefined };
  }

  private valid(watch: Watching): boolean {
    return watch.expiresAt > Date.now() && this.targets.get(watch.target.conversationId) === watch.target
      && this.sources.get(watch.target.endpointId) === watch.source
      && watch.viewer.isActive() && this.available(watch.target.conversationId);
  }

  sweep(): void {
    for (const [conversationId, target] of this.targets) {
      if (this.activeRun(conversationId) !== target.runId) this.removeTarget(conversationId);
    }
    for (const watch of this.watches.values()) {
      if (!this.valid(watch)) this.closeWatch(watch, 'expired');
    }
  }

  private closeWatch(watch: Watching, reason: CloseReason): void {
    this.watches.delete(watch.requestId);
    const closed = { type: 'closed', requestId: watch.requestId, reason } as const;
    watch.viewer.send(closed);
    watch.source.send(closed);
  }
}
