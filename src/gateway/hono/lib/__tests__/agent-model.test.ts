import { describe, expect, it } from 'vitest';

import {
  agentImageGenerationModelAutoProviderFallback,
  agentImageGenerationModelTimeoutMs,
  agentModelFallbacksToArray,
  agentModelRefToString,
  normalizePatchAgentImageGenerationModel,
  normalizePatchAgentModel,
  normalizePatchTypedModels,
} from '../agent-model.js';

describe('agentModelRefToString / agentModelFallbacksToArray', () => {
  it('reads primary from object refs and rejects everything else', () => {
    expect(agentModelRefToString({ primary: 'openai/x' })).toBe('openai/x');
    expect(agentModelRefToString({ primary: '  ' })).toBeUndefined();
    expect(agentModelRefToString('openai/x')).toBeUndefined();
    expect(agentModelRefToString(undefined)).toBeUndefined();
    expect(agentModelRefToString({})).toBeUndefined();
  });

  it('returns [] when fallbacks is missing or malformed', () => {
    expect(agentModelFallbacksToArray('openai/x')).toEqual([]);
    expect(agentModelFallbacksToArray({})).toEqual([]);
    expect(agentModelFallbacksToArray({ fallbacks: 'nope' as unknown as string[] })).toEqual([]);
    expect(agentModelFallbacksToArray({ fallbacks: ['a', '', 'b', 42 as unknown as string] })).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('agentImageGenerationModelTimeoutMs', () => {
  it('returns null for missing / non-positive / non-numeric', () => {
    expect(agentImageGenerationModelTimeoutMs(undefined)).toBeNull();
    expect(agentImageGenerationModelTimeoutMs('openai/x')).toBeNull();
    expect(agentImageGenerationModelTimeoutMs({})).toBeNull();
    expect(agentImageGenerationModelTimeoutMs({ timeoutMs: 0 })).toBeNull();
    expect(agentImageGenerationModelTimeoutMs({ timeoutMs: -5 })).toBeNull();
    expect(agentImageGenerationModelTimeoutMs({ timeoutMs: 'fast' })).toBeNull();
  });

  it('returns the positive value when present', () => {
    expect(agentImageGenerationModelTimeoutMs({ timeoutMs: 90_000 })).toBe(90_000);
  });
});

describe('agentImageGenerationModelAutoProviderFallback', () => {
  it('returns false unless autoProviderFallback === true', () => {
    expect(agentImageGenerationModelAutoProviderFallback(undefined)).toBe(false);
    expect(agentImageGenerationModelAutoProviderFallback('openai/x')).toBe(false);
    expect(agentImageGenerationModelAutoProviderFallback({})).toBe(false);
    expect(agentImageGenerationModelAutoProviderFallback({ autoProviderFallback: 'true' })).toBe(false);
    expect(agentImageGenerationModelAutoProviderFallback({ autoProviderFallback: true })).toBe(true);
  });
});

describe('normalizePatchAgentModel', () => {
  it('coerces objects into the canonical { primary, fallbacks? } shape', () => {
    expect(normalizePatchAgentModel({ primary: '  openai/x  ' })).toEqual({ primary: 'openai/x' });
    expect(normalizePatchAgentModel({ primary: 'a', fallbacks: [] })).toEqual({ primary: 'a' });
    expect(normalizePatchAgentModel({ primary: 'a', fallbacks: ['b', '', 'c'] })).toEqual({
      primary: 'a',
      fallbacks: ['b', 'c'],
    });
  });

  it('rejects strings and bodies without a usable primary', () => {
    expect(normalizePatchAgentModel('openai/x')).toBeUndefined();
    expect(normalizePatchAgentModel(undefined)).toBeUndefined();
    expect(normalizePatchAgentModel({})).toBeUndefined();
    expect(normalizePatchAgentModel({ primary: '   ' })).toBeUndefined();
  });
});

describe('normalizePatchAgentImageGenerationModel', () => {
  it('rejects strings + undefined + objects without primary', () => {
    expect(normalizePatchAgentImageGenerationModel('openai/x')).toBeUndefined();
    expect(normalizePatchAgentImageGenerationModel(undefined)).toBeUndefined();
    expect(normalizePatchAgentImageGenerationModel({})).toBeUndefined();
    expect(normalizePatchAgentImageGenerationModel({ fallbacks: [''] })).toBeUndefined();
  });

  it('returns an object even when only primary is set', () => {
    expect(normalizePatchAgentImageGenerationModel({ primary: '  openai/x  ' })).toEqual({
      primary: 'openai/x',
    });
  });

  it('keeps extra knobs (fallbacks, timeoutMs, autoProviderFallback)', () => {
    const out = normalizePatchAgentImageGenerationModel({
      primary: 'openai/x',
      fallbacks: ['b', ' c '],
      timeoutMs: 90_000,
      autoProviderFallback: true,
    });
    expect(out).toEqual({
      primary: 'openai/x',
      fallbacks: ['b', 'c'],
      timeoutMs: 90_000,
      autoProviderFallback: true,
    });
  });

  it('drops invalid timeoutMs / falsy autoProviderFallback', () => {
    const out = normalizePatchAgentImageGenerationModel({
      primary: 'openai/x',
      timeoutMs: -1,
      autoProviderFallback: false,
    });
    expect(out).toEqual({ primary: 'openai/x' });
  });

  it('floors fractional timeoutMs', () => {
    const out = normalizePatchAgentImageGenerationModel({
      primary: 'openai/x',
      timeoutMs: 1234.9,
    });
    expect(out).toEqual({ primary: 'openai/x', timeoutMs: 1234 });
  });
});

describe('normalizePatchTypedModels', () => {
  it('returns null for null and empty after filtering', () => {
    expect(normalizePatchTypedModels(null)).toBeNull();
    expect(normalizePatchTypedModels({ roles: {} })).toBeNull();
    expect(normalizePatchTypedModels({ roles: { Bad: { model: 'openai/x' } } })).toBeNull();
  });

  it('validates id and provider/model', () => {
    expect(
      normalizePatchTypedModels({
        roles: {
          small: { model: 'deepseek/flash', description: 'Fast' },
          large: { model: 'anthropic/claude' },
        },
      }),
    ).toEqual({
      small: { description: 'Fast', model: 'deepseek/flash' },
      large: { model: 'anthropic/claude' },
    });
  });

  it('does not accept row arrays', () => {
    expect(normalizePatchTypedModels([{ id: 'small', model: 'openai/a' }])).toBeUndefined();
  });
});
