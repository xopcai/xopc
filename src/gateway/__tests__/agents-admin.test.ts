import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  getGatewayAgentEffectiveConfig,
  listGatewayAgents,
  prepareCreateAgent,
  prepareUpdateAgent,
} from '../agents-admin.js';

function config() {
  return ConfigSchema.parse({
    agents: {
      default: 'main',
      defaults: {
        models: { chat: { primary: 'openai/gpt-5', fallbacks: [] }, intents: {} },
        skills: { mode: 'all-enabled', exclude: [] },
        tools: { exec_command: { mode: 'ask' } },
        workflows: {},
        runtime: {},
      },
      list: [{ id: 'main', enabled: true, profile: { name: 'Main' } }],
    },
  });
}

describe('agents admin', () => {
  it('creates a minimal agent that inherits every global capability', () => {
    const result = prepareCreateAgent(config(), { profile: { name: 'Code Helper' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.data.nextConfig.agents.list.find((agent) => agent.id === 'code-helper');
    expect(created).toMatchObject({ id: 'code-helper', profile: { name: 'Code Helper' } });
    expect(created?.models).toBeUndefined();
    expect(created?.skills).toBeUndefined();
    expect(created?.tools).toBeUndefined();
    expect(created?.workspace).toBeUndefined();
  });

  it('updates only explicit agent overrides and can reset them', () => {
    const created = prepareCreateAgent(config(), { profile: { name: 'Coder' } });
    if (!created.ok) throw new Error(created.error);
    const updated = prepareUpdateAgent(created.data.nextConfig, 'coder', {
      workspace: '/tmp/coder',
      models: { chat: { primary: 'anthropic/claude-opus-4-1', fallbacks: [] } },
      tools: { exec_command: { mode: 'allow' } },
      workflows: { default: 'code-review' },
      runtime: { maxTurns: 12 },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.nextConfig.agents.list[1]?.models?.chat?.primary).toBe('anthropic/claude-opus-4-1');
    expect(updated.data.nextConfig.agents.defaults.models.chat.primary).toBe('openai/gpt-5');
    expect(updated.data.nextConfig.agents.list[1]?.workflows?.default).toBe('code-review');
    expect(updated.data.nextConfig.agents.list[1]?.runtime?.maxTurns).toBe(12);
    const reset = prepareUpdateAgent(updated.data.nextConfig, 'coder', {
      workspace: null,
      models: null,
      tools: null,
      workflows: null,
      runtime: null,
    });
    expect(reset.ok && reset.data.nextConfig.agents.list[1]?.models).toBeUndefined();
    expect(reset.ok && reset.data.nextConfig.agents.list[1]?.workspace).toBeUndefined();
    expect(reset.ok && reset.data.nextConfig.agents.list[1]?.workflows).toBeUndefined();
    expect(reset.ok && reset.data.nextConfig.agents.list[1]?.runtime).toBeUndefined();
  });

  it('returns effective values and their source', () => {
    const result = getGatewayAgentEffectiveConfig(config(), 'main');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.config.models.chat.primary).toBe('openai/gpt-5');
    expect(result.data.sources['models.chat.primary']).toBe('global');
  });

  it('lists override and effective config separately', async () => {
    const result = await listGatewayAgents(config());
    expect(result.agents[0]?.override.models).toBeUndefined();
    expect(result.agents[0]?.effective.models.chat.primary).toBe('openai/gpt-5');
  });
});
