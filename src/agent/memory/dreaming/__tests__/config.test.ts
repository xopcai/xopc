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
    ['readOnly mode', { mode: 'readOnly', sources: ['session'], writePolicy: { curated: 'allow' } }],
    ['confirmWrite mode', { mode: 'confirmWrite', sources: ['session'], writePolicy: { curated: 'allow' } }],
    ['curated deny', { mode: 'auto', sources: ['session'], writePolicy: { curated: 'deny' } }],
    ['curated confirm', { mode: 'auto', sources: ['session'], writePolicy: { curated: 'confirm' } }],
  ] as const)('blocks automatic deep promotion for %s', (_label, memory) => {
    const resolved = resolveDreamingConfig(config(memory as UserContextConfig['memory']));

    expect(resolved.enabled).toBe(true);
    expect(resolved.phases.deep.enabled).toBe(false);
    expect(resolved.promotionWritePolicy.decision).not.toBe('allow');
  });

  it('allows deep promotion only when curated automatic writes are allowed', () => {
    const resolved = resolveDreamingConfig(config({
      mode: 'auto',
      sources: ['session'],
      writePolicy: { curated: 'allow' },
    }));

    expect(resolved.phases.deep.enabled).toBe(true);
    expect(resolved.promotionWritePolicy.decision).toBe('allow');
  });
});
