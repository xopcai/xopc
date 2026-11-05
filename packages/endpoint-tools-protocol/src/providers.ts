import { z } from 'zod';
import type { EndpointToolDescriptor } from './index.js';

export const PROVIDER_MAX_TOOLS = 100;
export const PROVIDER_MAX_CATALOG_BYTES = 128 * 1024;
export const providerLocalIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

export const providerIdentitySchema = z.strictObject({
  localId: providerLocalIdSchema.refine(value => value !== 'native', 'The native provider is reserved'),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  instructions: z.string().max(8_000).optional(),
  durableOperations: z.literal(1).optional(),
  gatewayFormInput: z.literal(1).optional(),
});

export const providerToolSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  artifactInput: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).optional(),
  resourceId: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional(),
  effect: z.enum(['read', 'write', 'destructive']),
  sensitivity: z.enum(['public', 'personal']),
  confirmation: z.enum(['never', 'always']),
  requiresForeground: z.boolean(),
  requiredPermissions: z.array(z.string().min(1).max(120)).max(20),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  maxConcurrency: z.number().int().min(1).max(4),
  supportsCancellation: z.boolean(),
  idempotent: z.boolean(),
  resultKinds: z.array(z.enum(['text', 'json', 'file'])).min(1).max(3),
});

export const capabilityProviderSchema = providerIdentitySchema.extend({
  tools: z.array(providerToolSchema).max(PROVIDER_MAX_TOOLS),
}).superRefine((provider, context) => {
  const names = new Set<string>();
  for (const [index, tool] of provider.tools.entries()) {
    if (names.has(tool.name)) context.addIssue({ code: 'custom', path: ['tools', index, 'name'], message: 'Duplicate provider tool' });
    names.add(tool.name);
  }
});

export const providerCatalogSchema = z.strictObject({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  providers: z.array(capabilityProviderSchema).max(20),
}).superRefine((catalog, context) => {
  const ids = new Set<string>();
  for (const [index, provider] of catalog.providers.entries()) {
    if (ids.has(provider.localId)) context.addIssue({ code: 'custom', path: ['providers', index, 'localId'], message: 'Duplicate provider identity' });
    ids.add(provider.localId);
  }
  if (new TextEncoder().encode(JSON.stringify(catalog)).byteLength > PROVIDER_MAX_CATALOG_BYTES) {
    context.addIssue({ code: 'custom', message: 'Provider catalog exceeds its byte budget' });
  }
});

export const providerStateSchema = z.strictObject({
  localId: providerLocalIdSchema,
  catalogRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.enum(['ready', 'needs_foreground', 'permission_missing', 'resource_busy', 'unavailable']),
  validForMs: z.number().int().min(1_000).max(60_000),
});

export const deviceTargetErrorSchema = z.enum([
  'TARGET_NOT_FOUND', 'TARGET_OFFLINE', 'TARGET_AMBIGUOUS', 'CAPABILITY_UNSUPPORTED',
  'AUTHORIZATION_REQUIRED', 'RESOURCE_BUSY', 'NEEDS_FOREGROUND', 'DISCOVERY_FAILED', 'OUTCOME_UNKNOWN',
]);

export type CapabilityProvider = z.infer<typeof capabilityProviderSchema>;
export type ProviderTool = z.infer<typeof providerToolSchema>;
export type ProviderCatalog = z.infer<typeof providerCatalogSchema>;
export type ProviderState = z.infer<typeof providerStateSchema>;
export type DeviceTargetError = z.infer<typeof deviceTargetErrorSchema>;

/** Names are reversible and cannot collide with native tools or another provider. */
export function providerToolName(localId: string, name: string): string {
  providerIdentitySchema.shape.localId.parse(localId);
  providerToolSchema.shape.name.parse(name);
  return `provider_${localId}.${name}`;
}

export function providerEndpointDescriptor(localId: string, tool: ProviderTool): EndpointToolDescriptor {
  if (tool.effect !== 'read' && tool.confirmation !== 'always') throw new Error('Provider mutations require local confirmation');
  const { outputSchema, artifactInput, resourceId: _resourceId, ...fields } = tool;
  if (artifactInput) {
    const properties = fields.inputSchema.properties as Record<string, unknown> | undefined;
    const property = properties?.[artifactInput] as { type?: unknown } | undefined;
    if (property?.type !== 'string' || !Array.isArray(fields.inputSchema.required) || !fields.inputSchema.required.includes(artifactInput)) {
      throw new Error('Artifact input must identify a required string argument');
    }
    fields.inputSchema = { ...fields.inputSchema, properties: { ...properties,
      [artifactInput]: { type: 'string', minLength: 36, maxLength: 36, description: 'Owner-authorized one-use artifact transfer ID' } } };
  }
  return { ...fields, name: providerToolName(localId, tool.name), policyId: 'provider.manifest',
    outputSchema: outputSchema ? { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', required: ['type', 'value'],
      properties: { type: { const: 'json' }, value: inlineProviderOutputSchema(outputSchema) }, additionalProperties: false } }
      : { type: 'array', minItems: 1, maxItems: 20 } };
}

function resolveSchemaPointer(root: unknown, reference: string): unknown {
  if (!reference.startsWith('#/')) throw new Error('External and non-pointer schema references are not supported');
  let target = root;
  for (const part of decodeURIComponent(reference.slice(2)).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, part)) throw new Error('Schema reference is unresolved');
    target = (target as Record<string, unknown>)[part];
  }
  return target;
}

// Output schemas are embedded in the Endpoint content envelope. Resolve local
// pointers first so a provider's root cannot become the envelope root.
function inlineProviderOutputSchema(root: Record<string, unknown>): unknown {
  const single = new Set(['items', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema']);
  const arrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
  const maps = new Set(['properties', 'dependentSchemas']);
  let nodes = 0;
  const expand = (node: unknown, depth: number): unknown => {
    if (++nodes > 8_000 || depth > 24) throw new Error('Provider output schema exceeds its complexity budget');
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const { $ref, $id, $defs, definitions, ...fields } = node as Record<string, unknown>;
    if ($id !== undefined && node !== root) throw new Error('Nested output schema identities are not supported');
    const expanded = Object.fromEntries(Object.entries(fields).map(([key, value]) => {
      if (single.has(key)) return [key, expand(value, depth + 1)];
      if (arrays.has(key) && Array.isArray(value)) return [key, value.map(item => expand(item, depth + 1))];
      if (maps.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        return [key, Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, expand(schema, depth + 1)]))];
      }
      return [key, value];
    }));
    if ($ref === undefined) return expanded;
    if (typeof $ref !== 'string' || expanded.allOf !== undefined && !Array.isArray(expanded.allOf)) throw new Error('Invalid output schema reference');
    return { ...expanded, allOf: [...(Array.isArray(expanded.allOf) ? expanded.allOf : []), expand(resolveSchemaPointer(root, $ref), depth + 1)] };
  };
  return expand(root, 0);
}

/** Bound schemas before validation or compilation can consume host resources. */
export function assertProviderSchemaBudget(value: unknown): void {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (node: unknown, depth: number): void => {
    if (++nodes > 8_000 || depth > 24) throw new Error('Provider schema exceeds its complexity budget');
    if (!node || typeof node !== 'object') return;
    if (ancestors.has(node)) throw new Error('Recursive provider schema references are not supported');
    ancestors.add(node);
    try {
      if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
      for (const [key, child] of Object.entries(node)) {
        if (key === '$dynamicRef' || key === '$recursiveRef') throw new Error('Dynamic schema references are not supported');
        if (key === '$ref' && typeof child === 'string') {
          visit(resolveSchemaPointer(value, child), depth + 1);
        }
        if ((key === 'pattern' && typeof child === 'string') || key === 'patternProperties') throw new Error('Provider schema regular expressions are not supported');
        visit(child, depth + 1);
      }
    } finally { ancestors.delete(node); }
  };
  visit(value, 0);
}
