import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  extractAvatarFromIdentityMarkdown,
  listGatewayAgents,
  prepareCreateAgent,
  prepareCreateAgentsBatch,
  prepareDeleteAgent,
  prepareUpdateAgent,
  readAgentProfileFile,
} from '../agents-admin.js';

function minimalConfig(overrides: Partial<Config> = {}): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: {
      defaults: {
        workspace: '/tmp/ws-default',
        models: { chat: { primary: 'anthropic/claude-sonnet-4-5' } },
        maxTokens: 8192,
        temperature: 0.7,
        maxToolIterations: 20,
        maxRequestsPerTurn: 50,
        maxToolFailuresPerTurn: 3,
        thinkingDefault: 'medium',
        reasoningDefault: 'stream',
        verboseDefault: 'full',
      },
      list: [],
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
    '- **Creature:** assistant',
    '- **Emoji:**',
    '- **Avatar:**',
    '',
  ].join('\n');
}

describe('agents-admin', () => {
  it('listGatewayAgents includes default agent when list is empty', async () => {
    const cfg = minimalConfig();
    const { defaultId, agents, builtinToolIds } = await listGatewayAgents(cfg);
    expect(defaultId).toBe('main');
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe('main');
    expect(agents[0]?.isDefault).toBe(true);
    expect(Array.isArray(builtinToolIds)).toBe(true);
    expect(builtinToolIds.length).toBeGreaterThan(0);
    expect(agents[0]?.tools.effectiveDisable).toEqual([]);
    expect(agents[0]?.typedModels.defaults).toEqual([]);
    expect(agents[0]?.typedModels.effective).toEqual([]);
  });

  it('listGatewayAgents reports builtin agent skill allowlists from runtime profile', async () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        defaults: { ...minimalConfig().agents!.defaults!, skills: ['default-only'] },
        list: [{ id: 'coder', enabled: true, workspace: '/tmp/c', skills: ['old'] }],
      },
    } as Partial<Config>);
    const { agents } = await listGatewayAgents(cfg);
    const coder = agents.find((a) => a.id === 'coder');
    expect(coder?.skills.defaults).toEqual(['default-only']);
    expect(coder?.skills.entry).toEqual(['old']);
    expect(coder?.skills.effectiveAllowlist).toEqual(['old']);
  });

  it('listGatewayAgents exposes default, entry, and effective typed models', async () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        defaults: {
          ...minimalConfig().agents!.defaults!,
          models: { roles: { small: { model: 'deepseek/flash' } } },
        },
        list: [
          {
            id: 'coder',
            enabled: true,
            workspace: '/tmp/c',
            models: { roles: { small: { model: 'openai/mini' }, review: { model: 'anthropic/review' } } },
          },
        ],
      },
    } as Partial<Config>);
    const { agents } = await listGatewayAgents(cfg);
    const coder = agents.find((a) => a.id === 'coder');
    expect(coder?.typedModels.defaults).toEqual([{ id: 'small', model: 'deepseek/flash' }]);
    expect(coder?.typedModels.entry).toEqual([
      { id: 'review', model: 'anthropic/review' },
      { id: 'small', model: 'openai/mini' },
    ]);
    expect(coder?.typedModels.effective).toEqual([
      { id: 'review', model: 'anthropic/review' },
      { id: 'small', model: 'openai/mini' },
    ]);
  });

  it('extractAvatarFromIdentityMarkdown reads Avatar line', () => {
    const md = '# IDENTITY\n\n- **Avatar:** xopc:dicebear:pixel-art:Test\n';
    expect(extractAvatarFromIdentityMarkdown(md)).toBe('xopc:dicebear:pixel-art:Test');
    expect(extractAvatarFromIdentityMarkdown('')).toBeUndefined();
    expect(extractAvatarFromIdentityMarkdown('- **Avatar:**  \n')).toBeUndefined();
  });
  it('prepareUpdateAgent sets skills and tools.disable on custom list entry', () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        list: [{ id: 'note-taker', enabled: true, workspace: '/tmp/c' }],
      },
    } as Partial<Config>);
    const r = prepareUpdateAgent(cfg, 'note-taker', {
      skills: ['note'],
      tools: { disable: ['shell'] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const list = r.data.nextConfig.agents?.list ?? [];
    const e = list.find((x) => x.id === 'note-taker');
    expect(e?.skills).toEqual(['note']);
    expect(e?.tools?.disable).toEqual(['shell']);
  });

  it('prepareUpdateAgent sets skills on builtin agent list entries', () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        list: [{ id: 'coder', enabled: true, workspace: '/tmp/c', skills: ['old'] }],
      },
    } as Partial<Config>);
    const r = prepareUpdateAgent(cfg, 'coder', {
      skills: ['note'],
      tools: { disable: ['shell'] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.data.nextConfig.agents?.list?.find((x) => x.id === 'coder');
    expect(e?.skills).toEqual(['note']);
    expect(e?.tools?.disable).toEqual(['shell']);
  });
  it('prepareCreateAgent uses explicit id seed for agent id without writing display fields to config', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      id: 'nice-bot',
      workspace: '/tmp/ws-nice',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Nice Label') },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const list = r.data.nextConfig.agents?.list ?? [];
    const e = list.find((x) => x.id === 'nice-bot');
    expect(e).toMatchObject({ id: 'nice-bot', workspace: '/tmp/ws-nice' });
    expect('name' in (e ?? {})).toBe(false);
    expect('description' in (e ?? {})).toBe(false);
  });

  it('prepareCreateAgent rejects invalid explicit agent id', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      id: 'bad id',
      workspace: '/tmp/w',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Label') },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
    }
  });

  it('prepareCreateAgent rejects create without IDENTITY.md unless cloning', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, { id: 'plain', workspace: '/tmp/plain' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain('IDENTITY.md');
    }
  });

  it('prepareCreateAgent rejects Windows reserved explicit id', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      id: 'con',
      workspace: '/tmp/w',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Label') },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
    }
  });

  it('prepareCreateAgent rejects display name that cannot yield a folder-safe id', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      workspace: '/tmp/w',
      profileFiles: { 'IDENTITY.md': identityMarkdown('!!!') },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
    }
  });

  it('prepareCreateAgent rejects duplicate id', () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        list: [{ id: 'coder', enabled: true, workspace: '/tmp/c' }],
      },
    } as Partial<Config>);
    const r = prepareCreateAgent(cfg, {
      id: 'coder',
      workspace: '/tmp/x',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Coder') },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
    }
  });

  it('prepareCreateAgent sets tools.disable on new entry', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      id: 'coder',
      workspace: '/tmp/c',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Coder') },
      tools: { disable: ['shell', 'image_generate'] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.data.nextConfig.agents?.list?.find((x) => x.id === 'coder');
    expect(e?.tools?.disable).toEqual(['shell', 'image_generate']);
  });

  it('prepareCreateAgent sets models and skills on custom new entry', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      id: 'custom-researcher',
      workspace: '/tmp/researcher',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Researcher') },
      skills: ['research'],
      models: {
        chat: { primary: 'openai/gpt-4.1' },
        roles: { deep: { model: 'anthropic/claude-sonnet-4', description: 'Deep synthesis' } },
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.data.nextConfig.agents?.list?.find((x) => x.id === 'custom-researcher');
    expect(e?.skills).toEqual(['research']);
    expect(e?.models).toEqual({
      chat: { primary: 'openai/gpt-4.1' },
      roles: { deep: { model: 'anthropic/claude-sonnet-4', description: 'Deep synthesis' } },
    });
  });
  it('prepareCreateAgent rejects unsupported profileFiles name', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      id: 'coder',
      workspace: '/tmp/c',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Coder'), '../../../etc/passwd': 'x' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
    }
  });

  it('prepareCreateAgent rejects non-string profileFiles content', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      id: 'coder',
      workspace: '/tmp/c',
      profileFiles: { 'IDENTITY.md': identityMarkdown('Coder'), 'SOUL.md': 42 as unknown as string },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
    }
  });

  it('prepareCreateAgentsBatch adds multiple agents in one config pass', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgentsBatch(cfg, [
      {
        id: 'coder',
        workspace: '/tmp/coder',
        profileFiles: { 'IDENTITY.md': identityMarkdown('Coder') },
      },
      {
        id: 'writer',
        workspace: '/tmp/writer',
        profileFiles: { 'IDENTITY.md': identityMarkdown('Writer') },
        tools: { disable: ['shell'] },
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const list = r.data.nextConfig.agents?.list ?? [];
    expect(list.some((e) => e.id === 'coder')).toBe(true);
    expect(list.some((e) => e.id === 'writer')).toBe(true);
    expect(r.data.created.map((c) => c.agentId).sort()).toEqual(['coder', 'writer']);
    const writer = list.find((e) => e.id === 'writer');
    expect(writer?.tools?.disable).toEqual(['shell']);
  });

  it('prepareCreateAgentsBatch rejects empty array', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgentsBatch(cfg, []);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
    }
  });

  it('prepareCreateAgentsBatch fails fast on duplicate id in batch', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgentsBatch(cfg, [
      { id: 'dup', workspace: '/tmp/a', profileFiles: { 'IDENTITY.md': identityMarkdown('A') } },
      { id: 'dup', workspace: '/tmp/b', profileFiles: { 'IDENTITY.md': identityMarkdown('B') } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
    }
  });

  it('prepareDeleteAgent refuses main', () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        list: [{ id: 'main', enabled: true }],
      },
    } as Partial<Config>);
    const r = prepareDeleteAgent(cfg, 'main');
    expect(r.ok).toBe(false);
  });

  it('readAgentProfileFile rejects unsupported filename', async () => {
    const cfg = minimalConfig();
    const r = await readAgentProfileFile(cfg, 'main', '../../../etc/passwd');
    expect(r.ok).toBe(false);
  });
});
