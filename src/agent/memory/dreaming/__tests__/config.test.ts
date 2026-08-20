import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../../config/schema.js';
import type { UserContextConfig } from '../../../../user-context/config.js';
import { resolveDreamingConfig } from '../config.js';

function config(memory: UserContextConfig['memory']): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({ ...base, userContext: { ...base.userContext, memory, dreaming: { enabled: true } } });
}

describe('resolveDreamingConfig', () => {
  it.each([
    ['readOnly mode', { mode: 'readOnly', sources: ['session'], writePolicy: { understanding: 'allow' } }],
    ['confirmWrite mode', { mode: 'confirmWrite', sources: ['session'], writePolicy: { understanding: 'allow' } }],
    ['understanding deny', { mode: 'auto', sources: ['session'], writePolicy: { understanding: 'deny' } }],
    ['understanding confirm', { mode: 'auto', sources: ['session'], writePolicy: { understanding: 'confirm' } }],
  ] as const)('keeps deep analysis enabled for %s', (_label, memory) => {
    const resolved = resolveDreamingConfig(config(memory as UserContextConfig['memory']));

    expect(resolved.enabled).toBe(true);
    expect(resolved.phases.deep.enabled).toBe(true);
    expect(resolved.promotionWritePolicy.decision).not.toBe('allow');
  });

  it('allows deep promotion only when understanding automatic writes are allowed', () => {
    const resolved = resolveDreamingConfig(config({
      mode: 'auto',
      sources: ['session'],
      writePolicy: { understanding: 'allow' },
    }));

    expect(resolved.phases.deep.enabled).toBe(true);
    expect(resolved.promotionWritePolicy.decision).toBe('allow');
  });
});
