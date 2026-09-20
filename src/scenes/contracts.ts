import { createHash } from 'node:crypto';

import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const uniqueIds = z.array(identifier).max(100).refine((items) => new Set(items).size === items.length, 'Duplicate identifiers');

export const sceneOutcomeKinds = ['no_change', 'observation', 'artifact', 'decision', 'state_change', 'effect_proposal', 'receipt'] as const;
export const activationStatuses = ['needs_setup', 'active', 'paused', 'completed', 'archived'] as const;
export type ActivationStatus = typeof activationStatuses[number];

export const sceneScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personal') }),
  z.strictObject({ kind: z.literal('project'), id: identifier }),
  z.strictObject({ kind: z.literal('conversation'), id: identifier }),
  z.strictObject({ kind: z.literal('objects'), ids: uniqueIds.refine((ids) => ids.length > 0) }),
]);
export type SceneScope = z.infer<typeof sceneScopeSchema>;

const limitsSchema = z.strictObject({
  timeoutSeconds: z.number().int().min(1).max(600),
  maxIterations: z.number().int().min(1).max(30),
  maxToolCalls: z.number().int().min(0).max(100),
  maxOutputTokens: z.number().int().min(1).max(32_768),
});

export const sceneTemplateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  key: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  goalMode: z.enum(['finite', 'ongoing']),
  availability: z.enum(['available', 'history_only']).optional(),
  contextProviders: uniqueIds,
  triggers: z.array(z.discriminatedUnion('type', [
    z.strictObject({ id: identifier, type: z.literal('manual') }),
    z.strictObject({ id: identifier, type: z.literal('event'), eventType: identifier }),
    z.strictObject({ id: identifier, type: z.literal('schedule') }),
  ])).min(1).max(20).refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Duplicate trigger IDs'),
  execution: z.strictObject({
    kind: z.literal('agent'),
    instruction: z.string().trim().min(1).max(32_000),
    limits: limitsSchema,
  }),
  allowedOutcomeKinds: z.array(z.enum(sceneOutcomeKinds)).min(1),
  allowedEffectHandlers: uniqueIds,
});
export type SceneTemplate = z.infer<typeof sceneTemplateSchema>;

export interface ScenePrincipal { ownerId: string; workspaceId: string }

export const scenePermissionSchema = z.strictObject({
  accountIds: uniqueIds,
  contextProviders: uniqueIds,
  effectHandlers: uniqueIds,
});
export type ScenePermission = z.infer<typeof scenePermissionSchema>;

export const sceneNotesSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  content: z.string().trim().max(32_000),
  validUntil: z.number().int().nonnegative().nullable().default(null),
});

export const activationInputSchema = z.strictObject({
  templateKey: identifier,
  templateVersion: identifier,
  goal: z.string().trim().min(1).max(12_000),
  scope: sceneScopeSchema,
  permissions: scenePermissionSchema,
});
export type ActivationInput = z.infer<typeof activationInputSchema>;
export interface SceneActivation extends ActivationInput, ScenePrincipal {
  id: string;
  status: ActivationStatus;
  revision: number;
}

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
