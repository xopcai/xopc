import { describe, expect, it } from 'vitest';

import type { EffectiveAgentManifest } from '../../agent-manifest/index.js';
import {
  buildAgentRuntimeProfile,
  buildMemoryRuntime,
  buildRuntimeToolRegistry,
  checkBoundary,
  resolveModelRole,
  resolveWorkflow,
  validateWorkflowForRuntime,
} from '../index.js';

const manifest: EffectiveAgentManifest = {
  id: 'coder',
  enabled: true,
  identity: {
    name: 'Coder',
    role: 'Software engineering agent',
    language: 'zh-CN',
    tone: 'direct',
  },
  responsibilities: {
    primary: ['Implement code changes'],
  },
  workspace: { root: '/tmp/workspace' },
  models: {
    defaultRole: 'deep',
    roles: {
      deep: { model: 'anthropic/claude-sonnet-4', description: 'Deep work' },
      small: { model: 'openai/gpt-4.1-mini' },
    },
  },
  tools: {
    builtin: {
      read_file: { mode: 'allow', scope: 'workspace' },
      exec_command: { mode: 'confirm', scope: 'workspace' },
      send_message: { mode: 'deny' },
      missing_tool: { mode: 'allow' },
    },
  },
  skills: { mode: 'all' },
  memory: { mode: 'readOnly', sources: ['session'] },
  workflows: {
    default: 'implement-change',
    allowed: ['implement-change', 'review-code'],
    suggested: [{ intent: 'review', workflow: 'review-code' }],
  },
  boundaries: {
    requiresConfirmation: ['exec_command'],
    forbidden: ['commit secrets'],
    escalation: ['production'],
  },
};

const catalog = [
  {
    name: 'read_file',
    category: 'file' as const,
    risk: 'low' as const,
    supportsConfirm: true,
    scopes: ['readonly' as const, 'workspace' as const],
    tool: { id: 'read' },
  },
  {
    name: 'exec_command',
    category: 'code' as const,
    risk: 'high' as const,
    supportsConfirm: true,
    scopes: ['workspace' as const],
    tool: { id: 'exec_command' },
  },
];

const workflowCatalog = [
  {
    id: 'implement-change',
    phases: [{ id: 'analyze', modelRole: 'deep', requiredTools: ['read_file'] }],
  },
  {
    id: 'review-code',
    phases: [{ id: 'review', modelRole: 'small', requiredTools: ['read_file', 'exec_command'] }],
  },
  {
    id: 'bad-workflow',
    phases: [{ id: 'bad', modelRole: 'missing', requiredTools: ['missing_tool'] }],
  },
];

describe('model router', () => {
  it('resolves requested roles and falls back to default role', () => {
    expect(resolveModelRole({ manifest, role: 'small' })).toMatchObject({
      role: 'small',
      model: 'openai/gpt-4.1-mini',
    });
    expect(resolveModelRole({ manifest, role: 'unknown' })).toMatchObject({
      role: 'deep',
      model: 'anthropic/claude-sonnet-4',
    });
  });
});

describe('runtime tool registry', () => {
  it('applies allow confirm deny and missing policy', () => {
    const registry = buildRuntimeToolRegistry({ manifest, catalog });

    expect(registry.tools.map((entry) => entry.name)).toEqual(['exec_command', 'read_file']);
    expect(registry.tools.find((entry) => entry.name === 'exec_command')?.requiresConfirmation).toBe(true);
    expect(registry.denied).toEqual(['send_message']);
    expect(registry.missing).toEqual(['missing_tool']);
  });
});

describe('boundary guard', () => {
  it('orders deny, escalate, confirm, allow decisions', () => {
    expect(checkBoundary({ manifest, action: 'commit secrets to repo' })).toMatchObject({ decision: 'deny' });
    expect(checkBoundary({ manifest, action: 'change production config' })).toMatchObject({ decision: 'escalate' });
    expect(checkBoundary({ manifest, action: 'run exec_command' })).toMatchObject({ decision: 'confirm' });
    expect(checkBoundary({ manifest, action: 'read source file' })).toMatchObject({ decision: 'allow' });
  });
});

describe('memory runtime', () => {
  it('allows configured reads and denies reads when memory is off', () => {
    const runtime = buildMemoryRuntime(manifest);
    expect(runtime.readableSources).toEqual(['session']);
    expect(runtime.canRead('session')).toBe(true);
    expect(runtime.canRead('workspace')).toBe(false);

    const offRuntime = buildMemoryRuntime({ ...manifest, memory: { mode: 'off', sources: ['session'] } });
    expect(offRuntime.canRead('session')).toBe(false);
  });

  it('enforces write mode target policy sensitivity and confidence', () => {
    const runtime = buildMemoryRuntime({
      ...manifest,
      memory: {
        mode: 'confirmWrite',
        sources: ['session', 'curated'],
        writePolicy: { curated: 'allow', workspace: 'confirm' },
        privacy: { crossAgentSharing: 'deny', sensitiveWritePolicy: 'confirm' },
      },
    });

    expect(runtime.checkWrite({ target: 'curated', content: 'Use pnpm', source: 'test' })).toMatchObject({
      decision: 'confirm',
    });
    expect(
      runtime.checkWrite({ target: 'workspace', content: 'Secret token is abc', source: 'test', sensitive: true }),
    ).toMatchObject({ decision: 'confirm', reason: 'memory candidate is sensitive' });
    expect(runtime.checkWrite({ target: 'workspace', content: 'Maybe', source: 'test', confidence: 0.1 })).toMatchObject({
      decision: 'deny',
      reason: 'memory confidence is too low',
    });
  });
});

describe('workflow runtime', () => {
  it('selects suggested workflows by intent and falls back to default', () => {
    expect(resolveWorkflow({ manifest, catalog: workflowCatalog, intent: 'review' })).toMatchObject({
      workflow: { id: 'review-code' },
      reason: 'matched intent "review"',
    });
    expect(resolveWorkflow({ manifest, catalog: workflowCatalog, intent: 'unknown' })).toMatchObject({
      workflow: { id: 'implement-change' },
      reason: 'using default workflow',
    });
  });

  it('validates workflow phases against model roles and runtime tools', () => {
    const tools = buildRuntimeToolRegistry({ manifest, catalog });
    expect(validateWorkflowForRuntime({ manifest, workflow: workflowCatalog[0]!, tools })).toEqual([]);
    expect(validateWorkflowForRuntime({ manifest, workflow: workflowCatalog[2]!, tools }).map((issue) => issue.path)).toEqual([
      'phases.0.modelRole',
      'phases.0.requiredTools',
    ]);
  });
});

describe('agent runtime profile', () => {
  it('assembles prompt, tools, model router, and boundary guard', () => {
    const profile = buildAgentRuntimeProfile({ manifest, toolCatalog: catalog, workflowCatalog });

    expect(profile.promptSections.capability).toContain('<agent_identity>');
    expect(profile.tools.tools).toHaveLength(2);
    expect(profile.memory.canRead('session')).toBe(true);
    expect(profile.resolveModel().model).toBe('anthropic/claude-sonnet-4');
    expect(profile.resolveWorkflow('review').workflow?.id).toBe('review-code');
    expect(profile.validateWorkflow(workflowCatalog[0]!)).toEqual([]);
    expect(profile.checkBoundary('run exec_command').decision).toBe('confirm');
  });
});
