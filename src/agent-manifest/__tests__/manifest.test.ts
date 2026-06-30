import { describe, expect, it } from 'vitest';

import {
  buildAgentManifestPromptSection,
  resolveEffectiveAgentManifest,
  validateAgentManifest,
  type AgentManifest,
  type CapabilityPreset,
} from '../index.js';

const baseAgent: AgentManifest = {
  id: 'coder',
  enabled: true,
  extends: ['base-safe', 'code-tools'],
  identity: {
    name: 'Coder',
    role: 'Software engineering agent',
    language: 'zh-CN',
    tone: 'direct',
  },
  responsibilities: {
    primary: ['Implement code changes'],
    outOfScope: ['Deploy production without approval'],
  },
  workspace: { root: '/tmp/workspace' },
  models: {
    defaultRole: 'deep',
    roles: {
      deep: { model: 'anthropic/claude-sonnet-4' },
      small: { model: 'openai/gpt-4.1-mini' },
    },
  },
  tools: {
    builtin: {
      shell: { mode: 'confirm', scope: 'workspace' },
    },
  },
  skills: {
    mode: 'allowlist',
    allow: ['diagnose'],
  },
  memory: {
    mode: 'confirmWrite',
    sources: ['session', 'curated'],
    writePolicy: { curated: 'confirm' },
    privacy: {
      crossAgentSharing: 'readOnly',
      sensitiveWritePolicy: 'confirm',
    },
  },
  workflows: {
    default: 'implement-change',
    allowed: ['implement-change', 'review-code'],
  },
  boundaries: {
    requiresConfirmation: ['Run shell commands'],
    forbidden: ['Commit secrets'],
    escalation: ['Ambiguous production change'],
  },
};

const presets: Record<string, CapabilityPreset> = {
  'base-safe': {
    id: 'base-safe',
    name: 'Base Safety',
    version: 1,
    tools: {
      builtin: {
        send_message: { mode: 'confirm' },
        shell: { mode: 'deny' },
      },
    },
    memory: {
      mode: 'readOnly',
      sources: ['session'],
    },
    boundaries: {
      requiresConfirmation: ['External communication'],
      forbidden: ['Read secrets outside workspace'],
      escalation: [],
    },
  },
  'code-tools': {
    id: 'code-tools',
    name: 'Code Tools',
    version: 2,
    tools: {
      builtin: {
        read_file: { mode: 'allow', scope: 'workspace' },
        edit_file: { mode: 'confirm', scope: 'workspace' },
      },
    },
  },
};

describe('agent manifest resolver', () => {
  it('merges capability presets then applies agent overrides', () => {
    const result = resolveEffectiveAgentManifest({ agent: baseAgent, presets });

    expect(result.manifest.tools.builtin.read_file).toEqual({ mode: 'allow', scope: 'workspace' });
    expect(result.manifest.tools.builtin.send_message).toEqual({ mode: 'confirm' });
    expect(result.manifest.tools.builtin.shell).toEqual({ mode: 'confirm', scope: 'workspace' });
    expect(result.manifest.memory.mode).toBe('confirmWrite');
    expect(result.sources['tools.builtin.read_file.mode']).toBe('preset:code-tools@2');
    expect(result.sources['tools.builtin.shell.mode']).toBe('agent:coder');
  });

  it('honors locked preset paths', () => {
    const lockedPresets: Record<string, CapabilityPreset> = {
      locked: {
        id: 'locked',
        name: 'Locked',
        version: 1,
        tools: { builtin: { shell: { mode: 'deny' } } },
        locks: ['tools.builtin.shell.mode'],
      },
    };
    const agent: AgentManifest = { ...baseAgent, extends: ['locked'] };

    const result = resolveEffectiveAgentManifest({ agent, presets: lockedPresets });

    expect(result.manifest.tools.builtin.shell.mode).toBe('deny');
    expect(result.sources['tools.builtin.shell.mode']).toBe('preset:locked@1');
  });

  it('rejects missing presets and cycles', () => {
    expect(() => resolveEffectiveAgentManifest({ agent: { ...baseAgent, extends: ['missing'] }, presets })).toThrow(
      'was not found',
    );
    expect(() =>
      resolveEffectiveAgentManifest({
        agent: { ...baseAgent, extends: ['a'] },
        presets: {
          a: { id: 'a', name: 'A', version: 1, extends: ['b'] },
          b: { id: 'b', name: 'B', version: 1, extends: ['a'] },
        },
      }),
    ).toThrow('cycle');
  });
});

describe('agent manifest validator', () => {
  it('validates catalogs and default model role', () => {
    const result = validateAgentManifest({
      agent: baseAgent,
      presets,
      catalogs: {
        tools: ['read_file', 'edit_file', 'shell', 'send_message'],
        skills: ['diagnose'],
        workflows: ['implement-change', 'review-code'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('reports missing catalog entries', () => {
    const result = validateAgentManifest({
      agent: {
        ...baseAgent,
        models: { ...baseAgent.models, defaultRole: 'missing' },
        skills: { mode: 'allowlist', allow: ['not-installed'] },
      },
      presets,
      catalogs: {
        tools: ['read_file'],
        skills: ['diagnose'],
        workflows: ['review-code'],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['models.defaultRole', 'tools.builtin.shell', 'skills.allow', 'workflows.default']),
    );
  });
});

describe('agent manifest prompt', () => {
  it('renders concise runtime-facing sections', () => {
    const { manifest } = resolveEffectiveAgentManifest({ agent: baseAgent, presets });
    const prompt = buildAgentManifestPromptSection(manifest);

    expect(prompt).toContain('<agent_identity>');
    expect(prompt).toContain('Role: Software engineering agent');
    expect(prompt).toContain('shell: confirm, scope=workspace');
    expect(prompt).toContain('<memory_policy>');
    expect(prompt).toContain('Default: implement-change');
  });
});
