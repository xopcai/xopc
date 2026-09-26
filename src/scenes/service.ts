import { z } from 'zod';
import { SceneConfigureSchema, SceneTransitionSchema, SceneWorkItemCreateSchema, SceneWorkItemUpdateSchema } from '@xopcai/gateway-contract';

import { activationInputSchema, intersectPermissions, validateTemplate,
  type SceneActivation, type ScenePermission, type ScenePrincipal } from './contracts.js';
import type { SceneContextProvider } from './execution.js';
import { SceneCapabilityRegistry } from './registry.js';
import { SceneConflictError, SceneRepository } from './repository.js';
import { sceneScheduleSchema } from './schedule.js';

export class SceneSetupError extends Error {
  constructor(readonly missing: string[]) { super(`Scene setup is incomplete: ${missing.join(', ')}`); }
}

/** User-facing operations share one authorization boundary, independent of the UI. */
export class SceneApplicationService {
  constructor(
    private readonly repository: SceneRepository,
    private readonly providers: SceneCapabilityRegistry<SceneContextProvider>,
    private readonly authorize: (activation: SceneActivation) => Promise<ScenePermission>,
    private readonly clock: () => number = Date.now,
    private readonly modelReadiness: () => string[] = () => [],
  ) {}

  get database() { return this.repository.database; }

  async preflight(principal: ScenePrincipal, value: unknown): Promise<{ ready: boolean; missing: string[] }> {
    const input = activationInputSchema.parse(value);
    return this.checkReadiness({ ...input, ...principal, id: 'preflight', revision: 1, status: 'needs_setup' });
  }

  private async checkReadiness(activation: SceneActivation): Promise<{ ready: boolean; missing: string[] }> {
    const input = activation;
    const template = validateTemplate(this.repository.getTemplate(input.templateKey, input.templateVersion), {
      contextProviders: this.providers.ids(), effectHandlers: [], executionAdapters: ['agent'],
    });
    const permissions = intersectPermissions(input.permissions, await this.authorize(activation));
    const missing = template.contextProviders.filter((provider) => !permissions.contextProviders.includes(provider)).map((id) => `context:${id}`);
    missing.push(...this.modelReadiness());
    missing.push(...input.permissions.accountIds.filter((id) => !permissions.accountIds.includes(id)).map((id) => `account:${id}`));
    if (input.permissions.effectHandlers.length > 0) missing.push('read_only_execution');
    if (input.permissions.contextProviders.some((id) => !template.contextProviders.includes(id))) missing.push('unrequested_context');
    for (const providerId of template.contextProviders) missing.push(...(this.providers.get(providerId).setupIssues?.(activation) ?? []));
    return { ready: missing.length === 0, missing };
  }

  async start(principal: ScenePrincipal, value: unknown, requestId: string): Promise<SceneActivation> {
    if (!requestId.trim()) throw new Error('Scene request identity is required');
    const preflight = await this.preflight(principal, value);
    if (!preflight.ready) throw new SceneSetupError(preflight.missing);
    return this.startAfterPreflight(principal, value, requestId);
  }

  /** Commit only after a successful preflight; contains no asynchronous effects. */
  startAfterPreflight(principal: ScenePrincipal, value: unknown, requestId: string): SceneActivation {
    const activation = this.repository.createActivation(principal, value, requestId);
    if (activation.status !== 'needs_setup') return activation;
    return this.repository.transitionActivation(principal, activation.id, activation.revision, 'active', this.clock());
  }

  check(principal: ScenePrincipal, activationId: string, requestId: string): string {
    if (!requestId.trim() || requestId.length > 200) throw new Error('Scene request identity is required');
    const activation = this.repository.getActivation(principal, activationId);
    const template = this.repository.getTemplate(activation.templateKey, activation.templateVersion);
    const trigger = template.triggers.find((item) => item.type === 'manual');
    if (!trigger) throw new Error('Scene template does not support manual checks');
    return this.repository.acceptManualCheck(principal, activationId, trigger.id, requestId, this.clock());
  }

  async transition(principal: ScenePrincipal, id: string, value: unknown): Promise<SceneActivation> {
    await this.prepareTransition(principal, id, value);
    return this.transitionAfterPreflight(principal, id, value);
  }

  async prepareTransition(principal: ScenePrincipal, id: string, value: unknown): Promise<void> {
    const input = SceneTransitionSchema.parse(value);
    const activation = this.repository.getActivation(principal, id);
    if (this.repository.getTemplate(activation.templateKey, activation.templateVersion).execution.kind !== 'agent') {
      throw new SceneConflictError('Use the activation execution adapter');
    }
    if (activation.revision !== input.expectedRevision) throw new SceneConflictError('Scene activation changed');
    if (input.status === 'active') {
      const result = await this.checkReadiness(activation);
      if (!result.ready) throw new SceneSetupError(result.missing);
    }
  }

  /** The exact revision fences changes made while asynchronous readiness checks were running. */
  transitionAfterPreflight(principal: ScenePrincipal, id: string, value: unknown): SceneActivation {
    const input = SceneTransitionSchema.parse(value);
    const activation = this.repository.getActivation(principal, id);
    if (this.repository.getTemplate(activation.templateKey, activation.templateVersion).execution.kind !== 'agent') {
      throw new SceneConflictError('Use the activation execution adapter');
    }
    return this.repository.transitionActivation(principal, id, input.expectedRevision, input.status, this.clock());
  }

  configure(principal: ScenePrincipal, id: string, value: unknown): SceneActivation {
    const activation = this.repository.getActivation(principal, id);
    if (this.repository.getTemplate(activation.templateKey, activation.templateVersion).execution.kind !== 'agent') {
      throw new SceneConflictError('Use the activation execution adapter');
    }
    const { expectedRevision, ...input } = SceneConfigureSchema.parse(value);
    return this.repository.configureActivation(principal, id, expectedRevision, input);
  }

  writeNotes(principal: ScenePrincipal, id: string, value: unknown): number {
    return this.repository.writeNotes(principal, id, value, this.clock());
  }

  createWorkItem(principal: ScenePrincipal, id: string, value: unknown) {
    const input = SceneWorkItemCreateSchema.parse(value);
    return this.repository.createWorkItem(principal, id, input, this.clock());
  }

  setSchedule(principal: ScenePrincipal, id: string, triggerKey: string, value: unknown): number {
    const input = z.strictObject({ expectedRevision: z.number().int().nonnegative(), schedule: sceneScheduleSchema }).parse(value);
    return this.repository.setSchedule(principal, id, triggerKey, input.expectedRevision, input.schedule, this.clock());
  }

  updateWorkItem(principal: ScenePrincipal, id: string, value: unknown) {
    const input = SceneWorkItemUpdateSchema.parse(value);
    return this.repository.updateWorkItem(principal, id, input, this.clock());
  }
}
