import { createHash } from 'node:crypto';

export {
  sceneOutcomeKinds, activationStatuses, sceneScopeSchema, sceneTemplateSchema, scenePermissionSchema, sceneNotesSchema, activationInputSchema,
  type ActivationStatus, type SceneScope, type SceneTemplate, type ScenePrincipal, type ScenePermission, type ActivationInput, type SceneActivation,
} from '@xopcai/gateway-contract';

import { sceneTemplateSchema, type SceneTemplate, type ScenePermission, type ActivationStatus } from '@xopcai/gateway-contract';

/** Stable JSON hashing binds approvals and immutable versions to exact content. */
export function sceneContentHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    throw new Error('Scene content must be finite JSON');
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function validateTemplate(value: unknown, registered: Pick<ScenePermission, 'contextProviders' | 'effectHandlers'>): SceneTemplate {
  const template = sceneTemplateSchema.parse(value);
  for (const provider of template.contextProviders) {
    if (!registered.contextProviders.includes(provider)) throw new Error(`Unknown scene context provider: ${provider}`);
  }
  for (const handler of template.allowedEffectHandlers) {
    if (!registered.effectHandlers.includes(handler)) throw new Error(`Unknown scene effect handler: ${handler}`);
  }
  return template;
}

export function intersectPermissions(...permissions: ScenePermission[]): ScenePermission {
  if (permissions.length === 0) return { accountIds: [], contextProviders: [], effectHandlers: [] };
  const common = (key: keyof ScenePermission) => [...new Set(permissions[0][key])]
    .filter((id) => permissions.every((permission) => permission[key].includes(id))).sort();
  return { accountIds: common('accountIds'), contextProviders: common('contextProviders'), effectHandlers: common('effectHandlers') };
}

export function canTransitionActivation(from: ActivationStatus, to: ActivationStatus): boolean {
  const transitions: Record<ActivationStatus, readonly ActivationStatus[]> = {
    needs_setup: ['active', 'paused', 'archived'],
    active: ['needs_setup', 'paused', 'completed', 'archived'],
    paused: ['needs_setup', 'active', 'completed', 'archived'],
    completed: ['archived'],
    archived: [],
  };
  return transitions[from].includes(to);
}

export type SceneModelUsage = { provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
