import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { resolveEffectiveAgentConfig } from '../../agent-config/index.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { resolveAgentProfileDir } from '../agent-scope.js';
import { ensureStarterAgentsInitialized, STARTER_AGENTS } from '../starter-agents.js';

describe('starter Agent defaults', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-starter-agent-'));
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = stateDir;
    closeXopcDatabase();
    openXopcDatabase({ path: ':memory:' });
    new AgentCatalogRepository().ensureInitialized();
  });

  afterEach(() => {
    closeXopcDatabase();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('gives all ordinary starters the shared tool and Skill defaults', () => {
    expect(ensureStarterAgentsInitialized().changed).toBe(true);
    const catalog = new AgentCatalogRepository();
    expect(catalog.getSettings().defaultAgentId).toBe('main');
    expect(catalog.get('conductor')).toMatchObject({
      enabled: true, provisioningState: 'ready', profile: { name: 'Conductor' },
    });
    const snapshot = catalog.snapshot();
    for (const agent of snapshot.agents.filter(agent => agent.purpose !== 'task_dispatcher')) {
      expect(agent.toolAllowlist).toBeUndefined();
      expect(agent.tools).toBeUndefined();
      expect(agent.skills).toBeUndefined();
      expect(resolveEffectiveAgentConfig({ defaults: snapshot.defaults, agent }).config.skills)
        .toEqual({ mode: 'all-enabled', exclude: [] });
    }
    expect(catalog.get('task-router')).toMatchObject({ purpose: 'task_dispatcher', toolAllowlist: [] });
    expect(catalog.get('conductor')?.profile?.instructions).toContain('user-facing coordination Agent');
    expect(catalog.get('conductor')?.profile?.instructions).not.toContain('report only to main');
    expect(readFileSync(join(resolveAgentProfileDir('conductor'), 'SOUL.md'), 'utf8'))
      .toContain('You speak directly with the user');
    expect(ensureStarterAgentsInitialized().changed).toBe(false);
  });

  it('preserves an existing custom conductor profile and instructions', () => {
    const catalog = new AgentCatalogRepository();
    catalog.create({ id: 'conductor', profile: { name: '我的指挥家', instructions: '我的规则' } }, { ready: true });
    ensureStarterAgentsInitialized();
    const soulPath = join(resolveAgentProfileDir('conductor'), 'SOUL.md');
    writeFileSync(soulPath, '自定义档案');
    ensureStarterAgentsInitialized();
    expect(catalog.get('conductor')?.profile).toEqual({ name: '我的指挥家', instructions: '我的规则' });
    expect(catalog.get('conductor')?.toolAllowlist).toBeUndefined();
    expect(readFileSync(soulPath, 'utf8')).toBe('自定义档案');
  });

  it('upgrades the shipped Conductor allowlist and unedited tool guidance once', () => {
    const catalog = new AgentCatalogRepository();
    catalog.create({ id: 'conductor', toolAllowlist: [
      'xopc_use', 'tool_manual', 'session_recall', 'session_search',
      'knowledge_search', 'knowledge_get', 'user_context_search', 'user_context_get',
      'find', 'grep', 'read_file',
    ] }, { ready: true });
    ensureStarterAgentsInitialized();
    expect(catalog.get('conductor')?.toolAllowlist).toBeUndefined();

    const researcherTools = STARTER_AGENTS.find(agent => agent.id === 'researcher')!.profileFiles['TOOLS.md'];
    const toolsPath = join(resolveAgentProfileDir('researcher'), 'TOOLS.md');
    writeFileSync(toolsPath, researcherTools + '- Do not use exec_command, send_message, send_media, automation, or external sends.\n');
    expect(ensureStarterAgentsInitialized().changed).toBe(false);
    expect(readFileSync(toolsPath, 'utf8')).toBe(researcherTools);

    const customTools = researcherTools + '\nMy project-specific tool guidance.\n';
    writeFileSync(toolsPath, customTools);
    expect(ensureStarterAgentsInitialized().changed).toBe(false);
    expect(readFileSync(toolsPath, 'utf8')).toBe(customTools);
  });

  it('preserves manually configured tool and Skill restrictions', () => {
    const catalog = new AgentCatalogRepository();
    catalog.create({ id: 'conductor', toolAllowlist: ['read_file'], tools: { exec_command: { mode: 'deny' } },
      skills: { mode: 'replace', include: ['project-review'] } }, { ready: true });
    ensureStarterAgentsInitialized();
    expect(catalog.get('conductor')).toMatchObject({ toolAllowlist: ['read_file'], tools: { exec_command: { mode: 'deny' } },
      skills: { mode: 'replace', include: ['project-review'] } });
  });
});
