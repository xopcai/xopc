import { createHash } from 'node:crypto';

import { z } from 'zod';
import type { ActorRef, CapabilityDescriptor, CapabilitySurface, GatewayScope } from '@xopcai/gateway-contract';
import { executeAtomicOperation, OperationConflictError } from './atomic-operations.js';
import { CapabilityError } from './errors.js';
import { executeExternalOperation } from './external-operations.js';
import { SqliteCommitEffectError } from '../../storage/sqlite/transaction.js';
export { CapabilityError } from './errors.js';

/** Constructed by a trusted entry point, never parsed from tool or HTTP input. */
export interface CapabilityContext {
  principalId: string;
  surface: CapabilitySurface;
  scopes: readonly GatewayScope[];
  allowedCapabilities?: readonly string[];
  authorize: (id: string, input: unknown) => boolean | Promise<boolean>;
  signal?: AbortSignal;
  /** Synchronous lease/grant guard immediately before domain execution or receipt replay. */
  assertCurrent?: () => void;
  actor?: ActorRef;
}

export interface ReadCapability<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  id: string;
  majorVersion: number;
  description: string;
  effect: 'read';
  surfaces: readonly CapabilitySurface[];
  scopes: readonly GatewayScope[];
  input: I;
  output: O;
  execute: (input: z.output<I>, context: CapabilityContext) => z.input<O> | Promise<z.input<O>>;
}

export function defineReadCapability<I extends z.ZodType, O extends z.ZodType>(definition: ReadCapability<I, O>): ReadCapability<I, O> {
  return definition;
}

export interface AtomicCapability<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType>
  extends Omit<ReadCapability<I, O>, 'effect' | 'execute'> {
  effect: 'local-write';
  /** Bind receipts to trusted domain ownership that is not supplied in the public input. */
  requestScope?: (context: CapabilityContext) => string;
  /** Read-only asynchronous validation, skipped for committed receipt replay. Never perform effects here. */
  prepare?: (input: z.output<I>, context: CapabilityContext) => void | Promise<void>;
  execute: (input: z.output<I>, context: CapabilityContext & { operationId: string; idempotencyKey: string }) => z.input<O>;
  afterCommit?: (result: z.output<O>, input: z.output<I>) => void | Promise<void>;
}

export function defineAtomicCapability<I extends z.ZodType, O extends z.ZodType>(definition: AtomicCapability<I, O>): AtomicCapability<I, O> {
  return definition;
}

export interface ExternalCapability<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType>
  extends Omit<ReadCapability<I, O>, 'effect' | 'execute'> {
  effect: 'external-write';
  recovery: 'manual' | 'provider-idempotent';
  requestScope?: (context: CapabilityContext) => string;
  /** Provider-idempotent implementations must send operationId as the provider key. */
  execute: (input: z.output<I>, context: CapabilityContext & { operationId: string; idempotencyKey: string }) => Promise<z.input<O>>;
}

export function defineExternalCapability<I extends z.ZodType, O extends z.ZodType>(definition: ExternalCapability<I, O>): ExternalCapability<I, O> {
  return definition;
}

type CapabilityDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = ReadCapability<I, O> | AtomicCapability<I, O> | ExternalCapability<I, O>;

/** Stable JSON encoding for contract digests; rejects non-JSON values. */
export function canonicalCapabilityJson(value: unknown): string {
  const parsed = z.json().parse(value);
  const encode = (item: typeof parsed): string => {
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
    if (item && typeof item === 'object') {
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
    }
    return JSON.stringify(item);
  };
  return encode(parsed);
}

export class CapabilityDispatcher {
  private readonly entries = new Map<string, { definition: CapabilityDefinition; descriptor: CapabilityDescriptor }>();

  register<I extends z.ZodType, O extends z.ZodType>(definition: CapabilityDefinition<I, O>): void {
    if (!/^(xopc|extension)\.[a-zA-Z0-9_.-]+$/.test(definition.id) || !Number.isSafeInteger(definition.majorVersion) || definition.majorVersion < 1) {
      throw new Error('Invalid capability identity');
    }
    if (this.entries.has(definition.id)) throw new Error(`Duplicate capability: ${definition.id}`);
    const descriptor = {
      id: definition.id,
      majorVersion: definition.majorVersion,
      description: definition.description,
      effect: definition.effect,
      surfaces: [...definition.surfaces],
      inputSchema: z.toJSONSchema(definition.input, { io: 'input' }),
      outputSchema: z.toJSONSchema(definition.output, { io: 'output' }),
    };
    const descriptorDigest = createHash('sha256').update(canonicalCapabilityJson({ ...descriptor, scopes: definition.scopes,
      ...(definition.effect === 'external-write' ? { recovery: definition.recovery } : {}),
    })).digest('hex');
    this.entries.set(definition.id, {
      definition: { ...definition, scopes: [...definition.scopes], surfaces: [...definition.surfaces] },
      descriptor: { ...descriptor, descriptorDigest },
    });
  }

  private visible(definition: CapabilityDefinition, context: CapabilityContext): boolean {
    return Boolean(context.principalId)
      && definition.surfaces.includes(context.surface)
      && (!context.allowedCapabilities || context.allowedCapabilities.includes(definition.id))
      && definition.scopes.every(scope => context.scopes.includes('gateway.admin') || context.scopes.includes(scope));
  }

  list(context: CapabilityContext): CapabilityDescriptor[] {
    return [...this.entries.values()].filter(entry => this.visible(entry.definition, context))
      .map(entry => structuredClone(entry.descriptor));
  }

  describe(id: string, context: CapabilityContext): CapabilityDescriptor {
    const entry = this.entries.get(id);
    if (!entry || !this.visible(entry.definition, context)) throw new CapabilityError('NOT_FOUND', 'Capability not available');
    return structuredClone(entry.descriptor);
  }

  async call(id: string, input: unknown, context: CapabilityContext, expected?: { majorVersion: number; descriptorDigest: string; idempotencyKey?: string }): Promise<unknown> {
    const descriptor = this.describe(id, context);
    if (expected && (expected.majorVersion !== descriptor.majorVersion || expected.descriptorDigest !== descriptor.descriptorDigest)) {
      throw new CapabilityError('CONTRACT_CHANGED', 'Capability contract changed; describe it again');
    }
    const { definition } = this.entries.get(id)!;
    const parsed = definition.input.safeParse(input);
    if (!parsed.success) throw new CapabilityError('INVALID_INPUT', parsed.error.message);
    if (!await context.authorize(id, parsed.data)) throw new CapabilityError('FORBIDDEN', 'Capability resource access denied');
    context.assertCurrent?.();
    if (context.signal?.aborted) throw new CapabilityError('CANCELLED', 'Capability call cancelled');
    if (definition.effect === 'external-write') {
      const key = expected?.idempotencyKey;
      if (!key?.trim() || key.length > 200) throw new CapabilityError('INVALID_INPUT', 'A stable idempotencyKey is required');
      const normalizedInput = JSON.parse(JSON.stringify(parsed.data));
      const identity = definition.requestScope ? { input: normalizedInput, scope: definition.requestScope(context) } : normalizedInput;
      return executeExternalOperation({
        principalId: context.principalId, capabilityId: id, idempotencyKey: key,
        requestDigest: createHash('sha256').update(canonicalCapabilityJson(identity)).digest('hex'),
        descriptorDigest: descriptor.descriptorDigest, surface: context.surface, recovery: definition.recovery,
      }, operationId => definition.execute(parsed.data, { ...context, operationId, idempotencyKey: key }),
      result => this.validateResult(definition, result));
    }
    if (definition.effect === 'local-write') {
      const key = expected?.idempotencyKey;
      if (!key?.trim() || key.length > 200) throw new CapabilityError('INVALID_INPUT', 'A stable idempotencyKey is required');
      try {
        const normalizedInput = JSON.parse(JSON.stringify(parsed.data));
        const scope = definition.requestScope?.(context);
        const requestIdentity = definition.requestScope ? { input: normalizedInput, scope } : normalizedInput;
        const preparationRequired = Symbol('preparationRequired');
        let prepared = !definition.prepare;
        const execute = () => {
          context.assertCurrent?.();
          return executeAtomicOperation({
            principalId: context.principalId, capabilityId: id, idempotencyKey: key,
            requestDigest: createHash('sha256').update(canonicalCapabilityJson(requestIdentity)).digest('hex'),
            descriptorDigest: descriptor.descriptorDigest, surface: context.surface,
          }, operationId => {
            if (!prepared) throw preparationRequired;
            const output = definition.execute(parsed.data, { ...context, operationId, idempotencyKey: key });
            if (output && typeof (output as { then?: unknown }).then === 'function') throw new Error('Atomic capability handlers must be synchronous');
            return this.validateResult(definition, output);
          });
        };
        let result: unknown;
        try { result = execute(); }
        catch (error) {
          if (error !== preparationRequired) throw error;
          await definition.prepare!(parsed.data, context);
          if (!await context.authorize(id, parsed.data)) throw new CapabilityError('FORBIDDEN', 'Capability resource access denied');
          if (context.signal?.aborted) throw new CapabilityError('CANCELLED', 'Capability call cancelled');
          if (definition.requestScope?.(context) !== scope) throw new CapabilityError('REVISION_CONFLICT', 'Capability ownership changed during preparation');
          prepared = true;
          result = execute();
        }
        await definition.afterCommit?.(result, parsed.data);
        return result;
      } catch (error) {
        if (error instanceof OperationConflictError) throw new CapabilityError('REVISION_CONFLICT', error.message);
        if (error instanceof SqliteCommitEffectError) {
          const pending = new CapabilityError('UNAVAILABLE', 'Operation committed; post-commit work is pending. Retry the same idempotencyKey.');
          pending.cause = error;
          throw pending;
        }
        throw error;
      }
    }
    return this.validateResult(definition, await definition.execute(parsed.data, context));
  }

  private validateResult(definition: CapabilityDefinition, result: unknown): unknown {
    const validated = definition.output.safeParse(result);
    if (!validated.success) {
      const error = new CapabilityError('INTERNAL', 'Capability returned an invalid result');
      error.cause = validated.error;
      throw error;
    }
    return validated.data;
  }
}
