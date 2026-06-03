import { beforeEach, describe, expect, it } from 'vitest';

import {
  _resetLastWorkflowMemoryForTests,
  getLastWorkflowMemory,
} from '../last-run-memory.js';

describe('LastWorkflowMemory', () => {
  beforeEach(() => {
    _resetLastWorkflowMemoryForTests();
  });

  it('records and reads back per sessionKey', () => {
    const mem = getLastWorkflowMemory();
    mem.record('s1', { script: 'A', metaName: 'a', source: 'script', recordedAt: 1 });
    mem.record('s2', { script: 'B', metaName: 'b', source: 'name', recordedAt: 2 });
    expect(mem.get('s1')?.script).toBe('A');
    expect(mem.get('s2')?.script).toBe('B');
  });

  it('overwrites prior entry per sessionKey (last-wins)', () => {
    const mem = getLastWorkflowMemory();
    mem.record('s1', { script: 'A', metaName: 'a', source: 'script', recordedAt: 1 });
    mem.record('s1', { script: 'B', metaName: 'a', source: 'script', recordedAt: 2 });
    expect(mem.get('s1')?.script).toBe('B');
    expect(mem.get('s1')?.recordedAt).toBe(2);
  });

  it('returns undefined for missing or empty sessionKey', () => {
    const mem = getLastWorkflowMemory();
    expect(mem.get('missing')).toBeUndefined();
    expect(mem.get(undefined)).toBeUndefined();
    expect(mem.get('')).toBeUndefined();
  });

  it('record is a no-op when sessionKey is empty/undefined', () => {
    const mem = getLastWorkflowMemory();
    mem.record(undefined, { script: 'A', metaName: 'a', source: 'script', recordedAt: 1 });
    mem.record('', { script: 'A', metaName: 'a', source: 'script', recordedAt: 1 });
    expect(mem._size()).toBe(0);
  });

  it('clear(sessionKey) drops one; clear() drops all', () => {
    const mem = getLastWorkflowMemory();
    mem.record('s1', { script: 'A', metaName: 'a', source: 'script', recordedAt: 1 });
    mem.record('s2', { script: 'B', metaName: 'b', source: 'script', recordedAt: 2 });
    mem.clear('s1');
    expect(mem.get('s1')).toBeUndefined();
    expect(mem.get('s2')?.script).toBe('B');
    mem.clear();
    expect(mem.get('s2')).toBeUndefined();
  });

  it('singleton survives across getLastWorkflowMemory() calls', () => {
    getLastWorkflowMemory().record('s1', {
      script: 'A',
      metaName: 'a',
      source: 'script',
      recordedAt: 1,
    });
    expect(getLastWorkflowMemory().get('s1')?.script).toBe('A');
  });
});
