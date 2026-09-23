import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import {
  createGatewayAgent,
  getGatewayAgentEffectiveConfig,
  listGatewayAgents,
  updateGatewayAgent,
} from '../agents-admin.js';

const originalStateDir = process.env.XOPC_STATE_DIR;
let stateDir = '';

describe('agents admin', () => {
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-agents-admin-'));
    process.env.XOPC_STATE_DIR = stateDir;
    initializeTestAgentCatalog({
      defaults: {
        models: { chat: { primary: 'openai/gpt-5', fallbacks: [] }, intents: {} },
        skills: { mode: 'all-enabled', exclude: [] },
        tools: { exec_command: { mode: 'ask' } },
        workflows: {},
        runtime: {},
      },
      agents: [{ id: 'main', enabled: true, profile: { name: 'Main' } }],
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = originalStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates a minimal agent that inherits every global capability', async () => {
    const result = await createGatewayAgent({ profile: { name: 'Code Helper' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = new AgentCatalogRepository().get('code-helper');
    expect(created).toMatchObject({ id: 'code-helper', profile: { name: 'Code Helper' } });
    expect(created?.models).toBeUndefined();
    expect(created?.skills).toBeUndefined();
    expect(created?.tools).toBeUndefined();
    expect(created?.workspace).toBeUndefined();
  });

  it('creates an agent from a display name with no ASCII characters', async () => {
    const first = await createGatewayAgent({ profile: { name: '数据分析师' } });
    const second = await createGatewayAgent({ profile: { name: '数据分析师' } });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!first.ok) return;
    expect(first.data.agentId).toMatch(/^agent-[a-z0-9]{7}$/);
    expect(new AgentCatalogRepository().get(first.data.agentId)?.profile?.name).toBe('数据分析师');
  });

  it('updates only explicit agent overrides and can reset them', async () => {
    const created = await createGatewayAgent({ profile: { name: 'Coder' } });
    if (!created.ok) throw new Error(created.error);
    const updated = await updateGatewayAgent('coder', {
      workspace: '/tmp/coder',
      models: { chat: { primary: 'anthropic/claude-opus-4-1', fallbacks: [] } },
      tools: { exec_command: { mode: 'allow' } },
      workflows: { default: 'code-review' },
      runtime: { maxTurns: 12 },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const stored = new AgentCatalogRepository().get('coder');
    expect(stored?.models?.chat?.primary).toBe('anthropic/claude-opus-4-1');
    expect(new AgentCatalogRepository().getSettings().defaults.models.chat.primary).toBe('openai/gpt-5');
    expect(stored?.workflows?.default).toBe('code-review');
    expect(stored?.runtime?.maxTurns).toBe(12);
    const reset = await updateGatewayAgent('coder', {
      workspace: null,
      models: null,
      tools: null,
      workflows: null,
      runtime: null,
    });
    const resetStored = new AgentCatalogRepository().get('coder');
    expect(reset.ok && resetStored?.models).toBeUndefined();
    expect(reset.ok && resetStored?.workspace).toBeUndefined();
    expect(reset.ok && resetStored?.workflows).toBeUndefined();
    expect(reset.ok && resetStored?.runtime).toBeUndefined();
  });

  it('returns effective values and their source', () => {
    const result = getGatewayAgentEffectiveConfig('main');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.config.models.chat.primary).toBe('openai/gpt-5');
    expect(result.data.sources['models.chat.primary']).toBe('global');
  });

  it('lists override and effective config separately', async () => {
    const result = await listGatewayAgents();
    expect(result.agents[0]?.override.models).toBeUndefined();
    expect(result.agents[0]?.effective.models.chat.primary).toBe('openai/gpt-5');
  });
});
