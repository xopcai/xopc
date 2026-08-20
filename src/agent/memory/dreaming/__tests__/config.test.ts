import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../../config/schema.js';
import type { UserContextConfig } from '../../../../user-context/config.js';
import { resolveDreamingConfig } from '../config.js';

function config(memory: UserContextConfig['memory']): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({ ...base, userContext: { ...base.userContext, memory, dreaming: { mode: 'automatic' } } });
}

describe('resolveDreamingConfig', () => {
  it.each([
    ['readOnly mode', { mode: 'readOnly', sources: ['session'], writePolicy: { understanding: 'allow' } }],
    ['confirmWrite mode', { mode: 'confirmWrite', sources: ['session'], writePolicy: { understanding: 'allow' } }],
    ['automatic mode', { mode: 'auto', sources: ['session'] }],
  ] as const)('keeps deep analysis enabled for %s', (_label, memory) => {
    const resolved = resolveDreamingConfig(config(memory as UserContextConfig['memory']));

    expect(resolved.enabled).toBe(true);
    expect(resolved.phases.deep.enabled).toBe(true);
    expect(resolved.phases.deep.schedule).toEqual({ kind: 'daily', time: '03:00' });
    expect(resolved.timezone).toBeTruthy();
    expect(resolved.mode).not.toBe('off');
  });

  it('allows deep promotion only when understanding automatic writes are allowed', () => {
    const resolved = resolveDreamingConfig(config({
      mode: 'auto',
      sources: ['session'],
      writePolicy: { understanding: 'allow' },
    }), { automaticReady: true });

    expect(resolved.phases.deep.enabled).toBe(true);
    expect(resolved.mode).toBe('automatic');
    expect(resolved.writeDisposition).toBe('active');
  });

  it('downgrades automatic writes until the quality gate is ready', () => {
    const resolved = resolveDreamingConfig(config({ mode: 'auto', sources: ['session'] }));

    expect(resolved.requestedMode).toBe('automatic');
    expect(resolved.mode).toBe('review');
    expect(resolved.writeDisposition).toBe('candidate');
    expect(resolved.downgradeReason).toBe('quality_gate');
  });
});
