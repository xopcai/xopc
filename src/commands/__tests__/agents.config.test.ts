import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  applyAgentConfig,
  getAgentDeleteBlocker,
  pruneAgentConfig,
  setTuiDefaultAgentConfig,
} from '../agents.config.js';

function cfg(): Config {
  return {
    agents: {
      default: 'main',
      list: [
        { id: 'main' },
        { id: 'coder' },
        { id: 'writer' },
      ],
    },
    tui: { defaultAgent: 'coder' },
    bindings: [
      {
        agentId: 'writer',
        priority: 100,
        match: { channel: 'telegram' },
        enabled: true,
      },
    ],
  } as Config;
}

describe('agents.config', () => {
  it('uses a supplied identity when creating an agent', () => {
    const result = applyAgentConfig(
      { agents: { default: 'main', list: [] } } as Config,
      {
        agentId: 'main',
        identity: {
          name: 'Smart Assistant',
          description: 'General-purpose personal assistant.',
          role: 'General assistant',
          language: 'en',
          tone: 'direct',
        },
      },
    );

    expect(result.agents.list[0]?.identity).toMatchObject({
      name: 'Smart Assistant',
      description: 'General-purpose personal assistant.',
    });
  });

  it('blocks deleting the TUI default agent', () => {
    expect(getAgentDeleteBlocker(cfg(), 'coder')).toContain('TUI default agent');
    expect(() => pruneAgentConfig(cfg(), 'coder')).toThrow(/TUI default agent/);
  });

  it('blocks deleting the global default agent', () => {
    expect(getAgentDeleteBlocker(cfg(), 'main')).toContain('primary agent');
    expect(() => pruneAgentConfig(cfg(), 'main')).toThrow(/primary agent/);
  });

  it('can delete non-default agents and remove their bindings', () => {
    const result = pruneAgentConfig(cfg(), 'writer');
    expect(result.removedBindings).toBe(1);
    expect(result.config.agents.list.map((agent) => agent.id)).toEqual(['main', 'coder']);
    expect(result.config.bindings).toEqual([]);
  });

  it('sets the TUI default agent when the agent is enabled', () => {
    const result = setTuiDefaultAgentConfig(cfg(), ' WRITER ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBe('writer');
      expect(result.config.tui?.defaultAgent).toBe('writer');
    }
  });

  it('rejects missing or disabled TUI default agents', () => {
    expect(setTuiDefaultAgentConfig(cfg(), '   ')).toMatchObject({
      ok: false,
      message: 'Agent id is required.',
    });
    expect(setTuiDefaultAgentConfig(cfg(), 'writer@home')).toMatchObject({
      ok: false,
      message: 'Invalid agent id: writer@home',
    });
    expect(setTuiDefaultAgentConfig(cfg(), 'missing')).toMatchObject({
      ok: false,
      message: 'Agent "missing" not found or disabled.',
    });
    expect(setTuiDefaultAgentConfig({
      ...cfg(),
      agents: {
        default: 'main',
        list: [
          { id: 'main' },
          { id: 'coder', enabled: false },
        ],
      },
    } as Config, 'coder')).toMatchObject({
      ok: false,
      message: 'Agent "coder" not found or disabled.',
    });
  });
});
