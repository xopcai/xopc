import { activationInputSchema, intersectPermissions, validateTemplate,
  type SceneActivation, type ScenePermission, type ScenePrincipal } from './contracts.js';
import type { SceneContextProvider } from './execution.js';
import { SceneRepository } from './repository.js';

/** User-facing operations share one authorization boundary, independent of the UI. */
export class SceneApplicationService {
  constructor(
    private readonly repository: SceneRepository,
    private readonly providers: readonly SceneContextProvider[],
    private readonly authorize: (activation: SceneActivation) => Promise<ScenePermission>,
    private readonly clock: () => number = Date.now,
  ) {}

  async preflight(principal: ScenePrincipal, value: unknown): Promise<{ ready: boolean; missing: string[] }> {
    const input = activationInputSchema.parse(value);
    const template = validateTemplate(this.repository.getTemplate(input.templateKey, input.templateVersion), {
      contextProviders: this.providers.map((provider) => provider.id), effectHandlers: [],
    });
    const activation: SceneActivation = { ...input, ...principal, id: 'preflight', revision: 1, status: 'needs_setup' };
    const permissions = intersectPermissions(input.permissions, await this.authorize(activation));
    const missing = template.contextProviders.filter((provider) => !permissions.contextProviders.includes(provider)).map((id) => `context:${id}`);
    missing.push(...input.permissions.accountIds.filter((id) => !permissions.accountIds.includes(id)).map((id) => `account:${id}`));
    if (input.permissions.effectHandlers.length > 0) missing.push('read_only_execution');
    if (input.permissions.contextProviders.some((id) => !template.contextProviders.includes(id))) missing.push('unrequested_context');
    if (template.key === 'mail-follow-up' && (input.scope.kind !== 'objects' || input.scope.ids.length !== 1 || input.permissions.accountIds.length !== 1)) missing.push('one_mail_thread_and_account');
    return { ready: missing.length === 0, missing };
  }

  async start(principal: ScenePrincipal, value: unknown, requestId: string): Promise<SceneActivation> {
    if (!requestId.trim()) throw new Error('Scene request identity is required');
    const preflight = await this.preflight(principal, value);
    if (!preflight.ready) throw new Error(`Scene setup is incomplete: ${preflight.missing.join(', ')}`);
    const activation = this.repository.createActivation(principal, value, requestId);
    if (activation.status !== 'needs_setup') return activation;
    return this.repository.transitionActivation(principal, activation.id, activation.revision, 'active');
  }

  check(principal: ScenePrincipal, activationId: string, requestId: string): string {
    if (!requestId.trim() || requestId.length > 200) throw new Error('Scene request identity is required');
    const activation = this.repository.getActivation(principal, activationId);
    const template = this.repository.getTemplate(activation.templateKey, activation.templateVersion);
    const trigger = template.triggers.find((item) => item.type === 'manual');
    if (!trigger) throw new Error('Scene template does not support manual checks');
    return this.repository.acceptManualCheck(principal, activationId, trigger.id, requestId, this.clock());
  }
}
