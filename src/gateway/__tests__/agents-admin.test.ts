import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentManifest } from '../../agent-manifest/index.js';
import type { Config } from '../../config/schema.js';
import {
  extractAvatarFromIdentityMarkdown,
  getGatewayAgentEffectiveManifest,
  listAgentProfileFiles,
  listGatewayAgents,
  prepareCreateAgent,
  prepareDeleteAgent,
  prepareUpdateAgent,
  readAgentProfileFile,
} from '../agents-admin.js';

function manifest(id: string, patch: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: `/tmp/${id}` },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    memory: { mode: 'off', sources: ['session'] },
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
    ...patch,
  };
}

function minimalConfig(overrides: Partial<Config> = {}): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: {
      default: 'main',
      capabilityPresets: {},
      list: [manifest('main')],
    },
    channels: {},
    ...overrides,
  } as Config;
}

function identityMarkdown(name: string, description = ''): string {
  return [
    '# IDENTITY.md - Who Am I?',
    '',
    `- **Name:** ${name}`,
    `- **Description:** ${description}`,
    '- **Language:** en',
    '- **Avatar:**',
    '',
  ].join('\n');
}

describe('agents-admin', () => {
  it('listGatewayAgents includes manifest agents and effective policies', async () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        capabilityPresets: {},
        list: [
          manifest('main'),
          manifest('coder', {
            workspace: { root: '/tmp/coder' },
            models: {
              defaultRole: 'deep',
              roles: {
                deep: { model: 'anthropic/claude-sonnet-4-5' },
                review: { model: 'openai/gpt-4.1-mini' },
              },
            },
            skills: { mode: 'allowlist', allow: ['diagnose'] },
            tools: { builtin: { shell: { mode: 'deny' } } },
          }),
        ],
      },
    } as Partial<Config>);
    const { defaultId, agents, builtinToolIds } = await listGatewayAgents(cfg);
    const coder = agents.find((a) => a.id === 'coder');
    expect(defaultId).toBe('main');
    expect(coder?.workspace.replace(/\\/g, '/')).toMatch(/\/tmp\/coder$/);
    expect(coder?.model?.primary).toBe('anthropic/claude-sonnet-4-5');
    expect(coder?.skills.entry).toEqual(['diagnose']);
    expect(coder?.tools.effectiveDisable).toEqual(['shell']);
    expect(coder?.typedModels.effective.map((m) => m.id)).toEqual(['deep', 'review']);
    expect(builtinToolIds.length).toBeGreaterThan(0);
  });

  it('extractAvatarFromIdentityMarkdown reads Avatar line', () => {
    expect(extractAvatarFromIdentityMarkdown('# IDENTITY\n\n- **Avatar:** xopc:dicebear:pixel-art:Test\n')).toBe(
      'xopc:dicebear:pixel-art:Test',
    );
    expect(extractAvatarFromIdentityMarkdown('')).toBeUndefined();
  });

  it('prepareUpdateAgent writes manifest skills and tool policies', () => {
    const cfg = minimalConfig({
      agents: { default: 'main', capabilityPresets: {}, list: [manifest('main'), manifest('note-taker')] },
    } as Partial<Config>);
    const r = prepareUpdateAgent(cfg, 'note-taker', {
      skills: ['note'],
      tools: { builtin: { shell: { mode: 'deny' } } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.data.nextConfig.agents?.list?.find((x) => x.id === 'note-taker');
    expect(e?.skills).toEqual({ mode: 'allowlist', allow: ['note'] });
    expect(e?.tools.builtin.shell?.mode).toBe('deny');
  });

  it('prepareUpdateAgent writes preset inheritance', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        capabilityPresets: {
          'safe-coder': { id: 'safe-coder', name: 'Safe Coder', version: 1 },
        },
        list: [manifest('main'), manifest('coder')],
      },
    } as Partial<Config>);
    const r = prepareUpdateAgent(cfg, 'coder', { extends: ['safe-coder'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.data.nextConfig.agents?.list?.find((x) => x.id === 'coder');
    expect(e?.extends).toEqual(['safe-coder']);
  });

  it('getGatewayAgentEffectiveManifest exposes merged manifest sources', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          default: {
            id: 'default',
            name: 'Global defaults',
            version: 1,
            tools: { builtin: { web_search: { mode: 'allow' } } },
          },
          'safe-coder': {
            id: 'safe-coder',
            name: 'Safe Coder',
            version: 1,
            tools: { builtin: { shell: { mode: 'deny' } } },
            skills: { mode: 'allowlist', allow: ['diagnose'] },
          },
        },
        list: [
          manifest('main'),
          manifest('coder', {
            extends: ['safe-coder'],
            models: {
              defaultRole: 'deep',
              roles: { deep: { model: 'anthropic/claude-sonnet-4-5' } },
            },
          }),
        ],
      },
    } as Partial<Config>);
    const r = getGatewayAgentEffectiveManifest(cfg, 'coder');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.presetChain).toEqual(['default', 'safe-coder']);
    expect(r.data.manifest.tools.builtin.shell?.mode).toBe('deny');
    expect(r.data.manifest.tools.builtin.web_search?.mode).toBe('allow');
    expect(r.data.manifest.skills.mode).toBe('all');
    expect(r.data.manifest.models.roles.deep.model).toBe('anthropic/claude-sonnet-4-5');
    expect(r.data.sources['tools.builtin.shell.mode']).toBe('preset:safe-coder@1');
    expect(r.data.sources['skills.mode']).toBe('agent:coder');
    expect(r.data.sources['models.roles.deep.model']).toBe('agent:coder');
  });

  it('prepareCreateAgent creates a complete manifest entry', () => {
    const r = prepareCreateAgent(minimalConfig(), {
      id: 'custom-researcher',
      workspace: '/tmp/researcher',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Researcher') },
      skills: ['research'],
      models: {
        defaultRole: 'deep',
        roles: { deep: { model: 'anthropic/claude-sonnet-4', description: 'Deep synthesis' } },
      },
      tools: { builtin: { shell: { mode: 'deny' } } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.data.nextConfig.agents?.list?.find((x) => x.id === 'custom-researcher');
    expect((e?.workspace as { root?: string } | undefined)?.root?.replace(/\\/g, '/')).toMatch(/\/tmp\/researcher$/);
    expect(e?.skills).toEqual({ mode: 'allowlist', allow: ['research'] });
    expect(e?.models.roles.deep.model).toBe('anthropic/claude-sonnet-4');
    expect(e?.tools.builtin.shell?.mode).toBe('deny');
  });

  it('prepareCreateAgent rejects a defaultRole that is missing from roles', () => {
    const r = prepareCreateAgent(minimalConfig(), {
      id: 'bad-model-default',
      workspace: '/tmp/bad-model-default',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Bad Model Default') },
      models: {
        defaultRole: 'deep',
        roles: { small: { model: 'openai/gpt-4.1-mini' } },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('models.defaultRole must reference models.roles');
  });

  it('prepareUpdateAgent rejects roles that drop the defaultRole', () => {
    const r = prepareUpdateAgent(minimalConfig(), 'main', {
      models: {
        roles: { fast: { model: 'openai/gpt-4.1-mini' } },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('models.defaultRole must reference models.roles');
  });

  it('prepareCreateAgent rejects invalid and duplicate ids', () => {
    expect(
      prepareCreateAgent(minimalConfig(), {
        id: 'bad id',
        workspace: '/tmp/w',
        profileFiles: { 'IDENTITY.md': identityMarkdown('Label') },
      }).ok,
    ).toBe(false);
    expect(
      prepareCreateAgent(minimalConfig(), {
        id: 'main',
        workspace: '/tmp/w',
        profileFiles: { 'IDENTITY.md': identityMarkdown('Main') },
      }).ok,
    ).toBe(false);
  });

  it('prepareDeleteAgent refuses main', () => {
    expect(prepareDeleteAgent(minimalConfig(), 'main').ok).toBe(false);
  });

  it('prepareDeleteAgent returns a 400 for configured default agents', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'helper',
        capabilityPresets: {},
        list: [manifest('main'), manifest('helper'), manifest('coder')],
      },
      tui: { defaultAgent: 'coder' },
    } as Partial<Config>);

    const globalDefault = prepareDeleteAgent(cfg, 'helper');
    expect(globalDefault.ok).toBe(false);
    if (!globalDefault.ok) {
      expect(globalDefault.status).toBe(400);
      expect(globalDefault.error).toContain('global default agent');
    }

    const tuiDefault = prepareDeleteAgent(cfg, 'coder');
    expect(tuiDefault.ok).toBe(false);
    if (!tuiDefault.ok) {
      expect(tuiDefault.status).toBe(400);
      expect(tuiDefault.error).toContain('TUI default agent');
    }
  });

  it('readAgentProfileFile rejects unsupported filename', async () => {
    const r = await readAgentProfileFile(minimalConfig(), 'main', '../../../etc/passwd');
    expect(r.ok).toBe(false);
  });

  it('listAgentProfileFiles hides missing optional profile files', async () => {
    const prevStateDir = process.env.XOPC_STATE_DIR;
    const stateDir = mkdtempSync(join(tmpdir(), 'xopc-agents-admin-'));
    process.env.XOPC_STATE_DIR = stateDir;
    try {
      const profileDir = join(stateDir, 'agents', 'main', 'profile');
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, 'SOUL.md'), '# soul', 'utf-8');
      writeFileSync(join(profileDir, 'IDENTITY.md'), '# identity', 'utf-8');

      const r = await listAgentProfileFiles(minimalConfig(), 'main');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.files.map((f) => f.name)).toEqual(['IDENTITY.md', 'SOUL.md']);
    } finally {
      if (prevStateDir === undefined) {
        delete process.env.XOPC_STATE_DIR;
      } else {
        process.env.XOPC_STATE_DIR = prevStateDir;
      }
    }
  });
});
