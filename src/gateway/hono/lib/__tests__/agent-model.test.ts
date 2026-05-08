import { describe, expect, it } from 'vitest';

import {
  agentImageGenerationModelAutoProviderFallback,
  agentImageGenerationModelTimeoutMs,
  agentModelFallbacksToArray,
  agentModelRefToString,
  normalizePatchAgentImageGenerationModel,
  normalizePatchAgentModel,
} from '../agent-model.js';

describe('agentModelRefToString / agentModelFallbacksToArray', () => {
  it('handles plain strings + objects with primary', () => {
    expect(agentModelRefToString('openai/gpt-image-1')).toBe('openai/gpt-image-1');
    expect(agentModelRefToString({ primary: 'openai/x' })).toBe('openai/x');
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

describe('normalizePatchAgentModel (legacy)', () => {
  it('trims primary; drops empty fallbacks; collapses {primary} → string', () => {
    expect(normalizePatchAgentModel('  openai/x  ')).toBe('  openai/x  ');
    expect(normalizePatchAgentModel({ primary: '  openai/x  ' })).toBe('openai/x');
    expect(normalizePatchAgentModel({ primary: 'a', fallbacks: [] })).toBe('a');
    expect(normalizePatchAgentModel({ primary: 'a', fallbacks: ['b', '', 'c'] })).toEqual({
      primary: 'a',
      fallbacks: ['b', 'c'],
    });
  });
});

describe('normalizePatchAgentImageGenerationModel', () => {
  it('passes through plain strings + undefined', () => {
    expect(normalizePatchAgentImageGenerationModel('openai/x')).toBe('openai/x');
    expect(normalizePatchAgentImageGenerationModel(undefined)).toBeUndefined();
  });

  it('collapses to plain string when only primary is set', () => {
    expect(normalizePatchAgentImageGenerationModel({ primary: '  openai/x  ' })).toBe('openai/x');
  });

  it('keeps the object form when extra knobs are set', () => {
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
    expect(out).toBe('openai/x');
  });

  it('returns undefined when nothing usable is provided', () => {
    expect(normalizePatchAgentImageGenerationModel({})).toBeUndefined();
    expect(normalizePatchAgentImageGenerationModel({ fallbacks: [''] })).toBeUndefined();
  });

  it('floors fractional timeoutMs', () => {
    const out = normalizePatchAgentImageGenerationModel({
      primary: 'openai/x',
      timeoutMs: 1234.9,
    });
    expect(out).toEqual({ primary: 'openai/x', timeoutMs: 1234 });
  });
});
