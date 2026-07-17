import { describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../../agent-manifest/index.js';
import type { Config } from '../../../config/schema.js';
import { resolveMemoryAccessPolicy, type CrossAgentSharingMode } from '../access-policy.js';

function manifest(id: string, sharing: CrossAgentSharingMode): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: `/workspace/${id}` },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    memory: {
      mode: 'auto',
      sources: ['session'],
      privacy: { crossAgentSharing: sharing, sensitiveWritePolicy: 'confirm' },
    },
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
  };
}

function config(main: CrossAgentSharingMode, research: CrossAgentSharingMode): Config {
  return {
    agents: {
      default: 'main',
      capabilityPresets: {},
      list: [manifest('main', main), manifest('research', research)],
    },
  } as Config;
}

describe('MemoryAccessPolicy', () => {
  it('always permits access to the requesting agent own memory', () => {
    const policy = resolveMemoryAccessPolicy(config('deny', 'allow'), 'main');
    expect(policy.readableAgentIds).toEqual(['main']);
    expect(policy.canReadAgent('main')).toBe(true);
    expect(policy.canSubmitCandidate('main')).toBe(true);
  });

  it('requires bilateral participation for cross-agent reads', () => {
    expect(resolveMemoryAccessPolicy(config('readOnly', 'readOnly'), 'main').canReadAgent('research')).toBe(true);
    expect(resolveMemoryAccessPolicy(config('readOnly', 'deny'), 'main').canReadAgent('research')).toBe(false);
    expect(resolveMemoryAccessPolicy(config('deny', 'allow'), 'main').canReadAgent('research')).toBe(false);
  });

  it('requires bilateral allow for cross-agent candidate submission', () => {
    expect(resolveMemoryAccessPolicy(config('allow', 'allow'), 'main').canSubmitCandidate('research')).toBe(true);
    expect(resolveMemoryAccessPolicy(config('allow', 'readOnly'), 'main').canSubmitCandidate('research')).toBe(false);
    expect(resolveMemoryAccessPolicy(config('readOnly', 'allow'), 'main').canSubmitCandidate('research')).toBe(false);
  });
});
