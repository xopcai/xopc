import { describe, it, expect } from 'vitest';
import { diffConfigPaths } from '../diff.js';

describe('diffConfigPaths', () => {
  it('should return empty array for identical values', () => {
    const obj = { a: 1, b: 'test' };
    expect(diffConfigPaths(obj, obj)).toEqual([]);
  });

  it('should return empty array for same primitive values', () => {
    expect(diffConfigPaths(1, 1)).toEqual([]);
    expect(diffConfigPaths('test', 'test')).toEqual([]);
    expect(diffConfigPaths(null, null)).toEqual([]);
    expect(diffConfigPaths(undefined, undefined)).toEqual([]);
  });

  it('should detect primitive value changes', () => {
    expect(diffConfigPaths(1, 2)).toEqual(['<root>']);
    expect(diffConfigPaths('a', 'b')).toEqual(['<root>']);
    expect(diffConfigPaths(true, false)).toEqual(['<root>']);
    expect(diffConfigPaths(null, undefined)).toEqual(['<root>']);
  });

  it('should detect object property changes', () => {
    const prev = { a: 1, b: 'test' };
    const next = { a: 2, b: 'test' };
    expect(diffConfigPaths(prev, next)).toEqual(['a']);
  });

  it('should detect multiple property changes', () => {
    const prev = { a: 1, b: 'test', c: true };
    const next = { a: 2, b: 'changed', c: false };
    const paths = diffConfigPaths(prev, next);
    expect(paths).toContain('a');
    expect(paths).toContain('b');
    expect(paths).toContain('c');
  });

  it('should detect added properties', () => {
    const prev = { a: 1 };
    const next = { a: 1, b: 2 };
    expect(diffConfigPaths(prev, next)).toEqual(['b']);
  });

  it('should detect removed properties', () => {
    const prev = { a: 1, b: 2 };
    const next = { a: 1 };
    expect(diffConfigPaths(prev, next)).toEqual(['b']);
  });

  it('should handle nested objects', () => {
    const prev = { a: { b: { c: 1 } } };
    const next = { a: { b: { c: 2 } } };
    expect(diffConfigPaths(prev, next)).toEqual(['a.b.c']);
  });

  it('should handle deeply nested changes', () => {
    const prev = {
      agents: {
        defaults: {
          model: 'model-a',
          temperature: 0.5,
        },
      },
    };
    const next = {
      agents: {
        defaults: {
          model: 'model-b',
          temperature: 0.5,
        },
      },
    };
    expect(diffConfigPaths(prev, next)).toEqual(['agents.defaults.model']);
  });

  it('should handle multiple nested changes', () => {
    const prev = {
      providers: {
        openai: { apiKey: 'key1' },
        anthropic: { apiKey: 'key2' },
      },
    };
    const next = {
      providers: {
        openai: { apiKey: 'key1-new' },
        anthropic: { apiKey: 'key2' },
      },
    };
    expect(diffConfigPaths(prev, next)).toEqual(['providers.openai.apiKey']);
  });

  it('should handle array changes', () => {
    const prev = { items: [1, 2, 3] };
    const next = { items: [1, 2, 4] };
    expect(diffConfigPaths(prev, next)).toEqual(['items']);
  });

  it('should detect array length changes', () => {
    const prev = { items: [1, 2] };
    const next = { items: [1, 2, 3] };
    expect(diffConfigPaths(prev, next)).toEqual(['items']);
  });

  it('should return empty array for identical arrays', () => {
    const prev = { items: [1, 2, 3] };
    const next = { items: [1, 2, 3] };
    expect(diffConfigPaths(prev, next)).toEqual([]);
  });

  it('should handle mixed nested structures', () => {
    const prev = {
      a: 1,
      b: {
        c: [1, 2],
        d: { e: 'test' },
      },
    };
    const next = {
      a: 1,
      b: {
        c: [1, 3],
        d: { e: 'test' },
      },
    };
    expect(diffConfigPaths(prev, next)).toEqual(['b.c']);
  });

  it('should handle null to object changes', () => {
    const prev = { a: null };
    const next = { a: { b: 1 } };
    expect(diffConfigPaths(prev, next)).toEqual(['a']);
  });

  it('should handle object to null changes', () => {
    const prev = { a: { b: 1 } };
    const next = { a: null };
    expect(diffConfigPaths(prev, next)).toEqual(['a']);
  });

  it('should handle undefined values', () => {
    const prev = { a: undefined };
    const next = { a: 1 };
    expect(diffConfigPaths(prev, next)).toEqual(['a']);
  });

  it('should handle empty objects', () => {
    const prev = {};
    const next = { a: 1 };
    expect(diffConfigPaths(prev, next)).toEqual(['a']);
  });

  it('should handle custom prefix', () => {
    const prev = { a: 1 };
    const next = { a: 2 };
    expect(diffConfigPaths(prev, next, 'config')).toEqual(['config.a']);
  });

  it('should handle empty prefix', () => {
    const prev = { a: 1 };
    const next = { a: 2 };
    expect(diffConfigPaths(prev, next, '')).toEqual(['a']);
  });

  it('should handle complex config-like structures', () => {
    const prev = {
      agents: {
        defaults: {
          model: 'anthropic/claude-sonnet-4-5',
          maxTokens: 8192,
          temperature: 0.7,
        },
      },
      providers: {
        openai: { apiKey: 'key1' },
      },
      gateway: {
        port: 18790,
      },
    };
    const next = {
      agents: {
        defaults: {
          model: 'openai/gpt-4o',
          maxTokens: 8192,
          temperature: 0.8,
        },
      },
      providers: {
        openai: { apiKey: 'key2' },
      },
      gateway: {
        port: 18790,
      },
    };
    const paths = diffConfigPaths(prev, next);
    expect(paths).toContain('agents.defaults.model');
    expect(paths).toContain('agents.defaults.temperature');
    expect(paths).toContain('providers.openai.apiKey');
    expect(paths).not.toContain('gateway.port');
  });

  it('should not recurse into non-plain objects', () => {
    const date1 = new Date('2024-01-01');
    const date2 = new Date('2024-01-02');
    expect(diffConfigPaths(date1, date2)).toEqual(['<root>']);
  });

  it('should handle arrays vs non-arrays', () => {
    const prev = { a: [1, 2, 3] };
    const next = { a: { b: 1 } };
    expect(diffConfigPaths(prev, next)).toEqual(['a']);
  });
});
