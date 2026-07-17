import { describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../../../agent-manifest/index.js';
import type { Config } from '../../../../config/schema.js';
import { resolveDreamingConfig } from '../config.js';

function config(memory: AgentManifest['memory']): Config {
  return {
    agents: {
      default: 'main',
      capabilityPresets: {},
      list: [{
        id: 'main',
        enabled: true,
        identity: { name: 'main', role: 'Agent', language: 'en', tone: 'direct' },
        responsibilities: { primary: ['Help'] },
        workspace: { root: '/workspace' },
        models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
        tools: { builtin: {} },
        skills: { mode: 'all' },
        memory,
        workflows: {},
        boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
      }],
    },
  } as Config;
}

describe('resolveDreamingConfig', () => {
  it.each([
    ['readOnly mode', { mode: 'readOnly', sources: ['session'], dreaming: { enabled: true }, writePolicy: { curated: 'allow' } }],
    ['confirmWrite mode', { mode: 'confirmWrite', sources: ['session'], dreaming: { enabled: true }, writePolicy: { curated: 'allow' } }],
    ['curated deny', { mode: 'auto', sources: ['session'], dreaming: { enabled: true }, writePolicy: { curated: 'deny' } }],
    ['curated confirm', { mode: 'auto', sources: ['session'], dreaming: { enabled: true }, writePolicy: { curated: 'confirm' } }],
  ] as const)('blocks automatic deep promotion for %s', (_label, memory) => {
    const resolved = resolveDreamingConfig(config(memory as AgentManifest['memory']), 'main');

    expect(resolved.enabled).toBe(true);
    expect(resolved.phases.deep.enabled).toBe(false);
    expect(resolved.promotionWritePolicy.decision).not.toBe('allow');
  });

  it('allows deep promotion only when curated automatic writes are allowed', () => {
    const resolved = resolveDreamingConfig(config({
      mode: 'auto',
      sources: ['session'],
      dreaming: { enabled: true },
      writePolicy: { curated: 'allow' },
    }), 'main');

    expect(resolved.phases.deep.enabled).toBe(true);
    expect(resolved.promotionWritePolicy.decision).toBe('allow');
  });
});
