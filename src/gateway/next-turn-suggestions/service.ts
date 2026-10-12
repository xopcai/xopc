import { randomUUID } from 'node:crypto';

import type { NextTurnSuggestionResponse } from '@xopcai/gateway-contract';

import type { Config } from '../../config/schema.js';
import { resolveModelIntentRef, resolveModelSelector } from '../../config/agent-model-intents.js';
import { getSessionConfig } from '../../storage/sqlite/config-repository.js';
import { readNextTurnSuggestion, saveNextTurnSuggestion } from '../../storage/sqlite/next-turn-suggestion-repository.js';
import { createLogger } from '../../utils/logger.js';
import { onUserContextChange } from '../../user-context/changes.js';
import { generateNextTurnSuggestion } from './generator.js';
import { readSuggestionSnapshot, suggestionSnapshotKey, type SuggestionSnapshot } from './snapshot.js';

const log = createLogger('NextTurnSuggestion');
const TTL_MS = 30 * 60_000;

export class NextTurnSuggestionService {
  private readonly running = new Map<string, { key: string; controller: AbortController }>();
  private readonly unsubscribe: () => void;
  constructor(private readonly deps: {
    getConfig: () => Config; emit: (conversationId: string) => void; isAcceptingInput: (conversationId: string) => boolean;
    generate?: typeof generateNextTurnSuggestion; resolveModel?: (snapshot: SuggestionSnapshot) => string | undefined; timeoutMs?: number;
  }) {
    this.unsubscribe = onUserContextChange(change => { if (change.id && change.kind !== 'policy') this.changed(change.id); });
  }

  /** Only a composer GET schedules prediction; completion/invalidation announces the new state. */
  changed(conversationId: string): void {
    for (const [id, job] of this.running) if (id.startsWith(`${conversationId}:`)) job.controller.abort();
    this.deps.emit(conversationId);
  }

  dispose(): void {
    this.unsubscribe();
    for (const job of this.running.values()) job.controller.abort();
    this.running.clear();
  }

  private snapshot(conversationId: string, locale: 'zh' | 'en') {
    if (this.deps.isAcceptingInput(conversationId)) return null;
    const snapshot = readSuggestionSnapshot(conversationId);
    if (!snapshot) return null;
    const modelRef = this.deps.resolveModel ? this.deps.resolveModel(snapshot)
      : resolveModelIntentRef(this.deps.getConfig(), snapshot.agentId, 'fast')
        ?? getSessionConfig(conversationId)?.modelOverride
        ?? resolveModelSelector(this.deps.getConfig(), snapshot.agentId, 'fast');
    return { snapshot, modelRef, key: suggestionSnapshotKey(snapshot, locale, modelRef) };
  }

  get(conversationId: string, locale: 'zh' | 'en'): NextTurnSuggestionResponse {
    const current = this.snapshot(conversationId, locale);
    if (!current?.modelRef) return { status: 'none' };
    const cached = readNextTurnSuggestion(conversationId, locale, current.key);
    if (cached) return cached;
    const id = `${conversationId}:${locale}`;
    const previous = this.running.get(id);
    if (previous?.key === current.key && !previous.controller.signal.aborted) return { status: 'pending' };
    previous?.controller.abort();
    if (this.running.size >= 2) return { status: 'none' };
    const job = { key: current.key, controller: new AbortController() };
    this.running.set(id, job);
    void this.generate(id, locale, current, job);
    return { status: 'pending' };
  }

  private async generate(id: string, locale: 'zh' | 'en', current: { snapshot: SuggestionSnapshot; modelRef?: string; key: string },
    job: { key: string; controller: AbortController }): Promise<void> {
    const { snapshot } = current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let prompt: string | null = null;
    let timedOut = false;
    try {
      const timeout = new Promise<null>(resolve => {
        timer = setTimeout(() => { timedOut = true; job.controller.abort(); resolve(null); }, this.deps.timeoutMs ?? 3000);
      });
      const cancelled = new Promise<null>(resolve => {
        job.controller.signal.addEventListener('abort', () => resolve(null), { once: true });
      });
      prompt = await Promise.race([
        (this.deps.generate ?? generateNextTurnSuggestion)(snapshot, locale, current.modelRef!, job.controller.signal), timeout, cancelled,
      ]);
    } catch (err) {
      log.debug({ err, conversationId: snapshot.conversationId, phase: 'predict' }, 'Next turn suggestion unavailable');
    } finally {
      if (timer) clearTimeout(timer);
    }
    try {
      if (this.running.get(id) !== job) return;
      if (job.controller.signal.aborted && !timedOut) return;
      const latest = this.snapshot(snapshot.conversationId, locale);
      if (latest?.key !== current.key) return;
      const suggestionId = randomUUID();
      const expiresAt = Date.now() + TTL_MS;
      saveNextTurnSuggestion(snapshot.conversationId, locale, current.key, suggestionId, expiresAt,
        prompt && !job.controller.signal.aborted ? { id: suggestionId, conversationId: snapshot.conversationId,
          transcriptId: snapshot.transcriptId, sourceRunId: snapshot.sourceRunId, inputRevision: snapshot.inputRevision,
          transcriptCursor: snapshot.transcriptCursor, agentId: snapshot.agentId, locale, prompt, expiresAt } : null);
      this.deps.emit(snapshot.conversationId);
    } catch (err) {
      log.debug({ err, conversationId: snapshot.conversationId, phase: 'cache' }, 'Next turn suggestion discarded');
    } finally {
      if (this.running.get(id) === job) this.running.delete(id);
    }
  }
}
