import { describe, expect, it } from 'vitest';

import { canTransitionActivation, intersectPermissions, sceneContentHash, sceneTemplateSchema, validateTemplate } from '../contracts.js';

export const template = {
  schemaVersion: 1 as const, key: 'mail-follow-up', version: '1.0.0', title: '跟进重要邮件',
  description: 'Prepare a useful follow-up when a reply is due.', goalMode: 'ongoing' as const,
  contextProviders: ['mail'], triggers: [{ id: 'check', type: 'manual' as const }],
  execution: { kind: 'agent' as const, instruction: 'Prepare a follow-up from the authorized thread; never send.',
    limits: { timeoutSeconds: 90, maxIterations: 6, maxToolCalls: 6, maxOutputTokens: 2000 } },
  allowedOutcomeKinds: ['no_change', 'artifact', 'decision'] as const,
  allowedEffectHandlers: [],
};

describe('scene contracts', () => {
  it('accepts the minimal official agent template', () => {
    expect(validateTemplate(template, { contextProviders: ['mail'], effectHandlers: [] }).key).toBe('mail-follow-up');
  });
  it.each([{ schemaVersion: 0 }, { schemaVersion: 2 }, { legacy: true }, { execution: { kind: 'shell', command: 'pwd' } }])('rejects unsupported versions and executable extensions: %j', (change) => {
    expect(sceneTemplateSchema.safeParse({ ...template, ...change }).success).toBe(false);
  });
  it('rejects duplicate triggers and unknown providers', () => {
    expect(sceneTemplateSchema.safeParse({ ...template, triggers: [...template.triggers, ...template.triggers] }).success).toBe(false);
    expect(() => validateTemplate(template, { contextProviders: [], effectHandlers: [] })).toThrow('Unknown scene context provider');
  });
  it('never grants a permission missing in any authorization layer', () => {
    expect(intersectPermissions(
      { accountIds: ['personal', 'work'], contextProviders: ['mail'], effectHandlers: ['send'] },
      { accountIds: ['personal'], contextProviders: ['mail'], effectHandlers: [] },
    )).toEqual({ accountIds: ['personal'], contextProviders: ['mail'], effectHandlers: [] });
    expect(intersectPermissions().effectHandlers).toEqual([]);
  });
  it('hashes object keys canonically but binds array order and all content', () => {
    expect(sceneContentHash({ b: 2, a: 1 })).toBe(sceneContentHash({ a: 1, b: 2 }));
    expect(sceneContentHash(['a', 'b'])).not.toBe(sceneContentHash(['b', 'a']));
    expect(sceneContentHash({ recipient: 'a' })).not.toBe(sceneContentHash({ recipient: 'b' }));
    expect(() => sceneContentHash({ bad: undefined })).toThrow();
    expect(() => sceneContentHash(NaN)).toThrow();
  });
  it('cannot silently restart completed or archived delegations', () => {
    expect(canTransitionActivation('active', 'paused')).toBe(true);
    expect(canTransitionActivation('paused', 'active')).toBe(true);
    expect(canTransitionActivation('completed', 'active')).toBe(false);
    expect(canTransitionActivation('archived', 'active')).toBe(false);
  });
});
