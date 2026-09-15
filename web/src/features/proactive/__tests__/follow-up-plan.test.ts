import { describe, expect, it } from 'vitest';
import { delegationNextTrigger } from '../presentation';
import type { Delegation } from '../api';

describe('follow-up scheduling presentation', () => {
  const base = { effectiveEnabled: true, completedAt: null, scopeKind: 'workspace', checking: false } as Delegation;
  it('does not present an unused schedule as a promised run for event-driven work', () => {
    expect(delegationNextTrigger(base, true)).toBe('相关沟通需要下一步时回来');
    expect(delegationNextTrigger({ ...base, scopeKind: 'project' }, true)).toBe('项目出现重要变化时回来');
    expect(delegationNextTrigger({ ...base, effectiveEnabled: false }, true)).toBe('恢复后继续');
    expect(delegationNextTrigger({ ...base, completedAt: '2026-01-01' }, true)).toBe('不会再跟进');
  });
});
