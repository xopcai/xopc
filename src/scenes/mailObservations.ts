import { intersectPermissions, sceneContentHash, type SceneActivation, type ScenePermission } from './contracts.js';
import type { SceneContextProvider } from './execution.js';
import { SceneRepository } from './repository.js';

/** Observes only explicitly delegated threads; the host owns scan scheduling. */
export class SceneMailObservationService {
  private nextScanAt = 0;
  constructor(
    private readonly repository: SceneRepository,
    private readonly provider: SceneContextProvider,
    private readonly authorize: (activation: SceneActivation) => Promise<ScenePermission>,
    private readonly clock: () => number = Date.now,
    private readonly intervalMs = 0,
  ) {
    if (provider.id !== 'mail') throw new Error('Mail observation requires the mail context provider');
  }

  async scan(signal: AbortSignal, afterId = ''): Promise<{ changed: number; unavailable: number; nextCursor: string | null }> {
    signal.throwIfAborted();
    if (!afterId && this.clock() < this.nextScanAt) return { changed: 0, unavailable: 0, nextCursor: null };
    const items = this.repository.listMailObservationItems(afterId, this.clock());
    let changed = 0;
    let unavailable = 0;
    for (const { principal, item } of items) {
      signal.throwIfAborted();
      try {
        const activation = this.repository.getActivation(principal, item.activationId);
        const template = this.repository.getTemplate(activation.templateKey, activation.templateVersion);
        if (!template.contextProviders.includes('mail') || !template.triggers.some((trigger) => trigger.type === 'event' && trigger.eventType === 'mail.thread.changed')
          || activation.scope.kind !== 'objects' || !activation.scope.ids.includes(item.subjectId)) throw new Error('Mail observation is outside the template or delegated scope');
        const permissions = intersectPermissions(activation.permissions, await this.authorize(activation), {
          accountIds: [item.accountId], contextProviders: ['mail'], effectHandlers: [],
        });
        signal.throwIfAborted();
        if (!this.repository.isMailObservationCurrent(activation, item, this.clock())) throw new Error('Mail delegation changed during authorization');
        if (!permissions.accountIds.includes(item.accountId) || !permissions.contextProviders.includes('mail')) throw new Error('Mail observation permission is required');
        const evidence = await this.provider.read({ activation, permissions, subjectId: item.subjectId, signal });
        signal.throwIfAborted();
        if (!evidence.length || evidence.length > 100 || new Set(evidence.map((entry) => entry.id)).size !== evidence.length
          || evidence.reduce((size, entry) => size + entry.content.length, 0) > 120_000
          || evidence.some((entry) => !entry.id || !entry.revision || entry.ownerId !== principal.ownerId || entry.workspaceId !== principal.workspaceId
          || entry.accountId !== item.accountId || entry.subjectId !== item.subjectId || !Number.isFinite(entry.freshUntil) || entry.freshUntil <= this.clock())) throw new Error('Mail observation is incomplete or unauthorized');
        const currentPermissions = intersectPermissions(permissions, await this.authorize(activation));
        signal.throwIfAborted();
        if (!this.repository.isMailObservationCurrent(activation, item, this.clock())) throw new Error('Mail delegation changed during observation');
        if (sceneContentHash(currentPermissions) !== sceneContentHash(permissions)) throw new Error('Mail observation permission changed');
        const fingerprint = sceneContentHash(evidence.map(({ freshUntil: _freshUntil, ...entry }) => entry).sort((a, b) => a.id.localeCompare(b.id)));
        if (this.repository.observeMailWorkItem(principal, item, fingerprint, this.clock())) changed += 1;
      } catch {
        signal.throwIfAborted();
        unavailable += 1;
      }
    }
    const nextCursor = items.length === 100 ? items[items.length - 1].item.id : null;
    if (nextCursor === null) this.nextScanAt = this.clock() + this.intervalMs;
    return { changed, unavailable, nextCursor };
  }
}
