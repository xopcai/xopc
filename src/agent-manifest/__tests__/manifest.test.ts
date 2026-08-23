import { describe, expect, it } from 'vitest';

import {
  AgentManifestSchema,
  CapabilityPresetSchema,
  buildAgentManifestPromptSection,
  resolveEffectiveAgentManifest,
  validateAgentManifest,
  type AgentManifest,
  type AgentConfigEntry,
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
      exec_command: { mode: 'confirm', scope: 'workspace' },
    },
  },
  skills: {
    mode: 'allowlist',
    allow: ['diagnose'],
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
        exec_command: { mode: 'deny' },
      },
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
        apply_patch: { mode: 'confirm', scope: 'workspace' },
      },
    },
  },
};

describe('agent manifest resolver', () => {
  it('inherits skills and partial boundaries from presets when the agent omits them', () => {
    const agent: AgentConfigEntry = {
      id: 'researcher',
      identity: { name: 'Researcher', role: 'Research', language: 'en', tone: 'direct' },
      responsibilities: { primary: ['Research'] },
      workspace: { root: '/tmp/researcher' },
    };
    const result = resolveEffectiveAgentManifest({
      agent,
      defaultPresetId: 'default',
      presets: {
        default: {
          id: 'default',
          name: 'Default',
          version: 1,
          models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
          skills: { mode: 'allowlist', allow: ['research'] },
          boundaries: { forbidden: ['secrets'] },
        },
      },
    });

    expect(result.manifest.skills).toEqual({ mode: 'allowlist', allow: ['research'] });
    expect(result.manifest.boundaries).toEqual({
      requiresConfirmation: [],
      forbidden: ['secrets'],
      escalation: [],
    });
    expect(result.sources['skills.mode']).toBe('preset:default@1');
    expect(result.sources['boundaries.forbidden']).toBe('preset:default@1');
  });

  it('merges capability presets then applies agent overrides', () => {
    const result = resolveEffectiveAgentManifest({ agent: baseAgent, presets });

    expect(result.presetChain).toEqual(['base-safe', 'code-tools']);
    expect(result.manifest.tools.builtin.read_file).toEqual({ mode: 'allow', scope: 'workspace' });
    expect(result.manifest.tools.builtin.send_message).toEqual({ mode: 'confirm' });
    expect(result.manifest.tools.builtin.exec_command).toEqual({ mode: 'confirm', scope: 'workspace' });
    expect(result.sources['tools.builtin.read_file.mode']).toBe('preset:code-tools@2');
    expect(result.sources['tools.builtin.exec_command.mode']).toBe('agent:coder');
    expect(result.overrides).toContainEqual({
      path: 'tools.builtin.exec_command.mode',
      from: 'preset:base-safe@1',
      to: 'agent:coder',
    });
  });

  it('prepends the configured default preset when present', () => {
    const result = resolveEffectiveAgentManifest({
      agent: baseAgent,
      presets: {
        default: {
          id: 'default',
          name: 'Global defaults',
          version: 1,
          tools: { builtin: { web_search: { mode: 'allow' } } },
        },
        ...presets,
      },
      defaultPresetId: 'default',
    });

    expect(result.presetChain).toEqual(['default', 'base-safe', 'code-tools']);
    expect(result.manifest.extends).toEqual(['base-safe', 'code-tools']);
    expect(result.sources['tools.builtin.web_search.mode']).toBe('preset:default@1');
  });

  it('honors locked preset paths', () => {
    const lockedPresets: Record<string, CapabilityPreset> = {
      locked: {
        id: 'locked',
        name: 'Locked',
        version: 1,
        tools: { builtin: { exec_command: { mode: 'deny' } } },
        locks: ['tools.builtin.exec_command.mode'],
      },
    };
    const agent: AgentManifest = { ...baseAgent, extends: ['locked'] };

    const result = resolveEffectiveAgentManifest({ agent, presets: lockedPresets });

    expect(result.manifest.tools.builtin.exec_command.mode).toBe('deny');
    expect(result.sources['tools.builtin.exec_command.mode']).toBe('preset:locked@1');
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

  it('linearizes shared parents once in diamond inheritance', () => {
    const result = resolveEffectiveAgentManifest({
      agent: { ...baseAgent, extends: ['left', 'right'], tools: { builtin: {} } },
      presets: {
        base: {
          id: 'base',
          name: 'Base',
          version: 1,
          tools: { builtin: { exec_command: { mode: 'deny' } } },
        },
        left: {
          id: 'left',
          name: 'Left',
          version: 1,
          extends: ['base'],
          tools: { builtin: { exec_command: { mode: 'allow' } } },
        },
        right: { id: 'right', name: 'Right', version: 1, extends: ['base'] },
      },
    });

    expect(result.presetChain).toEqual(['base', 'left', 'right']);
    expect(result.manifest.tools.builtin.exec_command.mode).toBe('allow');
  });
});

describe('agent manifest validator', () => {
  it('accepts only supported prompt cache retention policies', () => {
    expect(AgentManifestSchema.safeParse({
      ...baseAgent,
      runtime: { promptCacheRetention: 'long' },
    }).success).toBe(true);
    expect(AgentManifestSchema.safeParse({
      ...baseAgent,
      runtime: { promptCacheRetention: 'forever' },
    }).success).toBe(false);
  });

  it('rejects agent-owned memory configuration', () => {
    const parsed = AgentManifestSchema.safeParse({
      ...baseAgent,
      memory: { mode: 'auto', sources: ['session'] },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects locks outside capability policy fields', () => {
    expect(CapabilityPresetSchema.safeParse({
      id: 'bad-lock',
      name: 'Bad lock',
      locks: ['identity.name'],
    }).success).toBe(false);
  });

  it('validates catalogs and default model role', () => {
    const result = validateAgentManifest({
      agent: baseAgent,
      presets,
      catalogs: {
        tools: ['read_file', 'apply_patch', 'exec_command', 'send_message'],
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
      expect.arrayContaining(['models.defaultRole', 'tools.builtin.exec_command', 'skills.allow', 'workflows.default']),
    );
  });
});

describe('agent manifest prompt', () => {
  it('renders concise runtime-facing sections', () => {
    const { manifest } = resolveEffectiveAgentManifest({ agent: baseAgent, presets });
    const prompt = buildAgentManifestPromptSection(manifest);

    expect(prompt).toContain('<agent_identity>');
    expect(prompt).toContain('Role: Software engineering agent');
    expect(prompt).toContain('exec_command: confirm, scope=workspace');
    expect(prompt).not.toContain('<memory_policy>');
    expect(prompt).toContain('Default: implement-change');
  });
});
