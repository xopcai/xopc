import { z } from 'zod';

import { intersectPermissions, sceneContentHash, type SceneActivation, type ScenePermission, type SceneTemplate } from './contracts.js';
import { SceneRepository } from './repository.js';

export const readOnlyResultSchema = z.strictObject({
  kind: z.enum(['no_change', 'observation', 'artifact', 'decision']),
  summary: z.string().max(32_000),
  evidenceIds: z.array(z.string().min(1)).max(100),
}).refine((result) => result.kind === 'no_change' || (result.summary.trim().length > 0 && result.evidenceIds.length > 0), 'A useful result requires evidence');
export type ReadOnlySceneResult = z.infer<typeof readOnlyResultSchema>;

export interface SceneEvidence {
  id: string;
  subjectId: string;
  ownerId: string;
  workspaceId: string;
  accountId?: string;
  projectId?: string;
  conversationId?: string;
  revision: string;
  occurredAt?: number;
  freshUntil: number;
  content: string;
}

export interface SceneContextProvider {
  id: string;
  read(input: { activation: SceneActivation; subjectId: string; permissions: ScenePermission; notBefore?: number; signal: AbortSignal }): Promise<SceneEvidence[]>;
}

export interface SceneReadOnlyExecutor {
  execute(input: { template: SceneTemplate; goal: string; evidence: SceneEvidence[]; signal: AbortSignal }): Promise<unknown>;
}

class SceneExecutionRejected extends Error {
  constructor(readonly reason: string) { super(reason); }
}

function evidenceAllowed(item: SceneEvidence, activation: SceneActivation, permissions: ScenePermission, now: number): boolean {
  if (!item.id || !item.revision || !Number.isFinite(item.freshUntil) || item.freshUntil <= now) return false;
  if (item.ownerId !== activation.ownerId || item.workspaceId !== activation.workspaceId) return false;
  if (item.accountId !== undefined && !permissions.accountIds.includes(item.accountId)) return false;
  const scope = activation.scope;
  if (scope.kind === 'objects') return scope.ids.includes(item.subjectId);
  if (scope.kind === 'project') return item.projectId === scope.id;
  if (scope.kind === 'conversation') return item.conversationId === scope.id;
  return true;
}

/** Runs one durable claim without exposing messaging, filesystem or write tools. */
export class SceneExecutionService {
  constructor(
    private readonly repository: SceneRepository,
    private readonly providers: readonly SceneContextProvider[],
    private readonly executor: SceneReadOnlyExecutor,
    private readonly authorize: (activation: SceneActivation) => Promise<ScenePermission>,
    private readonly clock: () => number = Date.now,
  ) {
    if (new Set(providers.map((provider) => provider.id)).size !== providers.length) throw new Error('Duplicate scene context providers');
  }

  async runNext(worker: string, outerSignal?: AbortSignal): Promise<'idle' | 'completed' | 'discarded' | 'failed'> {
    outerSignal?.throwIfAborted();
    const claim = this.repository.claimNext(worker, this.clock(), 620_000);
    if (!claim) return 'idle';
    const runInput = this.repository.getRunInput(claim, this.clock());
    if (!runInput) return 'discarded';
    const { activation, subjectId, accountId, notBefore } = runInput;
    const template = this.repository.getTemplate(activation.templateKey, activation.templateVersion);
    if (!this.repository.renewLease(claim, this.clock(), template.execution.limits.timeoutSeconds * 1000 + 5000)) return 'discarded';
    const controller = new AbortController();
    const abort = () => controller.abort(outerSignal?.reason);
    outerSignal?.addEventListener('abort', abort, { once: true });
    if (outerSignal?.aborted) abort();
    const timeout = setTimeout(() => controller.abort(new Error('Scene execution timed out')), template.execution.limits.timeoutSeconds * 1000);
    let stopWaiting: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      const listener = () => reject(controller.signal.reason ?? new Error('Scene execution aborted'));
      controller.signal.addEventListener('abort', listener, { once: true });
      stopWaiting = () => controller.signal.removeEventListener('abort', listener);
      if (controller.signal.aborted) listener();
    });
    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      if (!this.repository.getRunInput(claim, this.clock())) throw new SceneExecutionRejected('activation_changed');
    };
    const readContext = async () => {
      assertCurrent();
      const granted = await this.authorize(activation);
      assertCurrent();
      const permissions = intersectPermissions(granted, activation.permissions, {
        accountIds: accountId === undefined ? activation.permissions.accountIds : [accountId], contextProviders: template.contextProviders, effectHandlers: [],
      });
      const evidence: SceneEvidence[] = [];
      for (const providerId of template.contextProviders) {
        if (!permissions.contextProviders.includes(providerId)) throw new SceneExecutionRejected('needs_permission');
        const provider = this.providers.find((item) => item.id === providerId);
        if (!provider) throw new SceneExecutionRejected('provider_unavailable');
        const items = await provider.read({ activation, subjectId, permissions, notBefore, signal: controller.signal });
        assertCurrent();
        if (providerId === 'mail' && items.some((item) => item.accountId === undefined)) throw new SceneExecutionRejected('missing_account_identity');
        if (items.some((item) => !evidenceAllowed(item, activation, permissions, this.clock()))) throw new SceneExecutionRejected('unauthorized_or_stale_evidence');
        evidence.push(...items);
      }
      if (evidence.length > 100 || evidence.reduce((size, item) => size + item.content.length, 0) > 120_000) throw new SceneExecutionRejected('context_budget_exceeded');
      if (new Set(evidence.map((item) => item.id)).size !== evidence.length) throw new SceneExecutionRejected('duplicate_evidence');
      evidence.sort((left, right) => left.id.localeCompare(right.id));
      const fingerprint = sceneContentHash(evidence.map(({ freshUntil: _freshUntil, ...item }) => item));
      return { evidence, fingerprint, permissions };
    };
    const execute = async (): Promise<'completed' | 'discarded'> => {
      const snapshot = await readContext();
      if (!this.repository.saveSnapshot(claim, snapshot.fingerprint, snapshot.evidence.map((item) => item.id), this.clock())) return 'discarded';
      const raw = snapshot.evidence.length === 0
        ? { kind: 'no_change', summary: '', evidenceIds: [] }
        : await this.executor.execute({ template, goal: activation.goal, evidence: snapshot.evidence, signal: controller.signal });
      assertCurrent();
      const result = readOnlyResultSchema.parse(raw);
      if (result.evidenceIds.some((id) => !snapshot.evidence.some((item) => item.id === id))) throw new SceneExecutionRejected('unknown_evidence');
      const current = await readContext();
      assertCurrent();
      if (current.fingerprint !== snapshot.fingerprint || sceneContentHash(current.permissions) !== sceneContentHash(snapshot.permissions)) throw new SceneExecutionRejected('source_changed');
      return this.repository.finishReadOnlyRun(claim, result, this.clock()) ? 'completed' : 'discarded';
    };
    try {
      return await Promise.race([execute(), aborted]);
    } catch (error) {
      this.repository.failRun(claim, this.clock(), controller.signal.aborted ? 'execution_aborted' : error instanceof SceneExecutionRejected ? error.reason : 'execution_failed');
      return 'failed';
    } finally {
      clearTimeout(timeout);
      stopWaiting?.();
      outerSignal?.removeEventListener('abort', abort);
    }

  }
}
