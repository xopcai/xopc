import { intersectPermissions, sceneContentHash, type SceneActivation, type ScenePermission, type ScenePrincipal } from './contracts.js';
import type { SceneContextProvider } from './execution.js';
import { SceneRepository } from './repository.js';

/** Observes only explicitly delegated threads; the host owns scan scheduling. */
export class SceneMailObservationService {
  constructor(
    private readonly repository: SceneRepository,
    private readonly provider: SceneContextProvider,
    private readonly authorize: (activation: SceneActivation) => Promise<ScenePermission>,
    private readonly clock: () => number = Date.now,
  ) {
    if (provider.id !== 'mail') throw new Error('Mail observation requires the mail context provider');
  }

  async scan(principal: ScenePrincipal, signal: AbortSignal, afterId = ''): Promise<{ changed: number; unavailable: number; nextCursor: string | null }> {
    signal.throwIfAborted();
    const items = this.repository.listWatchingWorkItems(principal, afterId);
    let changed = 0;
    let unavailable = 0;
    for (const item of items) {
      signal.throwIfAborted();
      try {
        const activation = this.repository.getActivation(principal, item.activationId);
        const permissions = intersectPermissions(activation.permissions, await this.authorize(activation), {
          accountIds: [item.accountId], contextProviders: ['mail'], effectHandlers: [],
        });
        if (!permissions.accountIds.includes(item.accountId) || !permissions.contextProviders.includes('mail')) throw new Error('Mail observation permission is required');
        const evidence = await this.provider.read({ activation, permissions, subjectId: item.subjectId, signal });
        signal.throwIfAborted();
        if (!evidence.length || evidence.length > 100 || new Set(evidence.map((entry) => entry.id)).size !== evidence.length
          || evidence.reduce((size, entry) => size + entry.content.length, 0) > 120_000
          || evidence.some((entry) => !entry.id || !entry.revision || entry.ownerId !== principal.ownerId || entry.workspaceId !== principal.workspaceId
          || entry.accountId !== item.accountId || entry.subjectId !== item.subjectId || !Number.isFinite(entry.freshUntil) || entry.freshUntil <= this.clock())) throw new Error('Mail observation is incomplete or unauthorized');
        const currentPermissions = intersectPermissions(permissions, await this.authorize(activation));
        signal.throwIfAborted();
        if (sceneContentHash(currentPermissions) !== sceneContentHash(permissions)) throw new Error('Mail observation permission changed');
        const fingerprint = sceneContentHash(evidence.map(({ freshUntil: _freshUntil, ...entry }) => entry).sort((a, b) => a.id.localeCompare(b.id)));
        if (this.repository.observeMailWorkItem(principal, item, fingerprint, this.clock())) changed += 1;
      } catch {
        signal.throwIfAborted();
        unavailable += 1;
      }
    }
    return { changed, unavailable, nextCursor: items.length === 100 ? items[items.length - 1].id : null };
  }
}
