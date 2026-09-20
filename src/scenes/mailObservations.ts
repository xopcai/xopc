import { intersectPermissions, sceneContentHash, type SceneActivation, type ScenePermission } from './contracts.js';
import type { SceneContextProvider } from './execution.js';
import { sceneSourceFailureReason } from './readiness.js';
import { SceneRepository } from './repository.js';

/** Observes only explicitly delegated threads; the host owns scan scheduling. */
export class SceneMailObservationService {
  private nextScanAt = 0;
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly repository: SceneRepository,
    private readonly provider: SceneContextProvider,
    private readonly authorize: (activation: SceneActivation) => Promise<ScenePermission>,
    private readonly clock: () => number = Date.now,
    private readonly intervalMs = 0,
    private readonly itemTimeoutMs = 5000,
  ) {
    if (provider.id !== 'mail') throw new Error('Mail observation requires the mail context provider');
  }

  async scan(signal: AbortSignal, afterId = '', progress?: (id: string) => void): Promise<{ changed: number; unavailable: number; nextCursor: string | null }> {
    signal.throwIfAborted();
    if (!afterId && this.clock() < this.nextScanAt) return { changed: 0, unavailable: 0, nextCursor: null };
    const items = this.repository.listMailObservationItems(afterId, this.clock());
    const started = Date.now();
    let lastId = afterId;
    let processed = 0;
    let changed = 0;
    let unavailable = 0;
    for (const { principal, item } of items) {
      signal.throwIfAborted();
      if (Date.now() - started >= 20_000) break;
      lastId = item.id; processed += 1;
      const backoff = this.failures.get(item.accountId);
      if (this.intervalMs > 0 && backoff && backoff.until > this.clock()) { progress?.(lastId); continue; }
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error('Mail item timed out')), this.itemTimeoutMs);
      let rejectAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });
      let activation: SceneActivation | undefined;
      try {
        activation = this.repository.getActivation(principal, item.activationId);
        const template = this.repository.getTemplate(activation.templateKey, activation.templateVersion);
        if (!template.contextProviders.includes('mail') || !template.triggers.some((trigger) => trigger.type === 'event' && trigger.eventType === 'mail.thread.changed')
          || activation.scope.kind !== 'objects' || !activation.scope.ids.includes(item.subjectId)) throw new Error('Mail observation is outside the template or delegated scope');
        const permissions = intersectPermissions(activation.permissions, await Promise.race([this.authorize(activation), aborted]), {
          accountIds: [item.accountId], contextProviders: ['mail'], effectHandlers: [],
        });
        signal.throwIfAborted();
        if (!this.repository.isMailObservationCurrent(activation, item, this.clock())) throw new Error('Mail delegation changed during authorization');
        if (!permissions.accountIds.includes(item.accountId) || !permissions.contextProviders.includes('mail')) throw new Error('Mail observation permission is required');
        const evidence = await Promise.race([this.provider.read({ activation, permissions, subjectId: item.subjectId, signal: controller.signal }), aborted]);
        signal.throwIfAborted();
        if (!evidence.length || evidence.length > 100 || new Set(evidence.map((entry) => entry.id)).size !== evidence.length
          || evidence.reduce((size, entry) => size + entry.content.length, 0) > 120_000
          || evidence.some((entry) => !entry.id || !entry.revision || entry.ownerId !== principal.ownerId || entry.workspaceId !== principal.workspaceId
          || entry.accountId !== item.accountId || entry.subjectId !== item.subjectId || !Number.isFinite(entry.freshUntil) || entry.freshUntil <= this.clock())) throw new Error('Mail observation is incomplete or unauthorized');
        const currentPermissions = intersectPermissions(permissions, await Promise.race([this.authorize(activation), aborted]));
        signal.throwIfAborted();
        if (!this.repository.isMailObservationCurrent(activation, item, this.clock())) throw new Error('Mail delegation changed during observation');
        if (sceneContentHash(currentPermissions) !== sceneContentHash(permissions)) throw new Error('Mail observation permission changed');
        this.repository.recordSourceHealth(activation, null, this.clock());
        this.failures.delete(item.accountId);
        const fingerprint = sceneContentHash(evidence.map(({ freshUntil: _freshUntil, ...entry }) => entry).sort((a, b) => a.id.localeCompare(b.id)));
        if (this.repository.observeMailWorkItem(principal, item, fingerprint, this.clock())) changed += 1;
      } catch (error) {
        signal.throwIfAborted();
        unavailable += 1;
        const retryDelay = Math.max(this.intervalMs, Math.min(300_000, 10_000 * 2 ** Math.min((backoff?.count ?? 0) + 1, 5)));
        if (activation && this.repository.isMailObservationCurrent(activation, item, this.clock())) {
          this.repository.recordSourceHealth(activation, sceneSourceFailureReason(error), this.clock(), this.clock() + Math.max(retryDelay, 60_000));
        }
        if (this.intervalMs > 0) {
          const count = Math.min((backoff?.count ?? 0) + 1, 5);
          this.failures.set(item.accountId, { count, until: this.clock() + Math.min(300_000, 10_000 * 2 ** count) });
        }
      } finally {
        clearTimeout(timeout); signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', rejectAbort);
        if (!signal.aborted) progress?.(lastId);
      }
    }
    const nextCursor = processed < items.length || items.length === 100 ? lastId : null;
    if (nextCursor === null) this.nextScanAt = this.clock() + this.intervalMs;
    return { changed, unavailable, nextCursor };
  }
}
