import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '../types.js';
import { commandRegistry } from '../registry.js';
import { registerAgentEditCommand } from '../agent-edit.js';
import { resolveAgentProfileDir } from '../../agent/agent-scope.js';
import type { Config } from '../../config/schema.js';

function createConfig(): Config {
  return {
    agents: {
      default: 'coder',
      list: [{ id: 'coder', enabled: true }],
    },
  } as Config;
}

function createContext(config: Config): CommandContext {
  return {
    sessionKey: 'agent:coder:webchat:default:direct:test-session',
    source: 'webui',
    channelId: 'webui',
    chatId: 'test-session',
    senderId: 'test-user',
    isGroup: false,
    config,
    setTyping: vi.fn(async () => undefined),
    supports: () => false,
  } as unknown as CommandContext;
}

describe('/agent-edit', () => {
  const previousStateDir = process.env.XOPC_STATE_DIR;
  let stateDir: string;

  beforeEach(() => {
    commandRegistry.clear();
    registerAgentEditCommand();
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-agent-edit-'));
    process.env.XOPC_STATE_DIR = stateDir;
  });

  afterEach(() => {
    commandRegistry.clear();
    if (previousStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = previousStateDir;
    }
  });

  it('shows the requested profile file preview for the current session agent', async () => {
    const config = createConfig();
    const profileDir = resolveAgentProfileDir(config, 'coder');
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, 'SOUL.md'), '# SOUL\n\nWarm coding partner.', 'utf-8');

    const result = await commandRegistry.execute('agent-edit', createContext(config), 'SOUL.md --limit=200');

    expect(result.success).toBe(true);
    expect(result.content).toContain('Agent editor mode');
    expect(result.content).toContain('editing agent `coder`');
    expect(result.content).toContain('## SOUL.md');
    expect(result.content).toContain('Warm coding partner.');
  });

  it('rejects unsupported profile file names', async () => {
    const result = await commandRegistry.execute('agent-edit', createContext(createConfig()), '../xopc.json');

    expect(result.success).toBe(false);
    expect(result.content).toContain('Unsupported profile file');
  });
});
