import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../../agent-manifest/index.js';
import type { Config } from '../../../config/schema.js';
import {
  closeXopcDatabase,
  listMemoryRecords,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import { BuiltinMemoryStore } from '../builtin-memory-store.js';
import { BuiltinMemoryProvider } from '../builtin-provider.js';
import { resolveMemoryAccessPolicy, type CrossAgentSharingMode } from '../access-policy.js';
import { MemoryManager } from '../manager.js';

function manifest(id: string, sharing: CrossAgentSharingMode): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: `/workspace/${id}` },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    memory: {
      mode: 'auto',
      sources: ['session'],
      privacy: { crossAgentSharing: sharing, sensitiveWritePolicy: 'confirm' },
    },
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
  };
}

function config(main: CrossAgentSharingMode, research: CrossAgentSharingMode): Config {
  return {
    agents: {
      default: 'main',
      capabilityPresets: {},
      list: [manifest('main', main), manifest('research', research)],
    },
  } as Config;
}

describe('cross-agent structured memory', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-cross-agent-memory-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(root, { recursive: true, force: true });
  });

  async function managerFor(cfg: Config): Promise<MemoryManager> {
    const accessPolicy = resolveMemoryAccessPolicy(cfg, 'main');
    const store = new BuiltinMemoryStore({
      workspaceDir: '/workspace/main',
      memoriesDir: join(root, 'agents/main/memories'),
      userMemoryPath: join(root, 'user/MEMORY.md'),
      memoryCharLimit: 2200,
      userCharLimit: 1375,
      userProfileEnabled: false,
    });
    const manager = new MemoryManager({ accessPolicy });
    manager.addProvider(new BuiltinMemoryProvider(store, accessPolicy));
    await manager.initializeAll('agent:main:webchat:default:dm:user', {
      workspace: '/workspace/main',
      agentId: 'main',
    });
    return manager;
  }

  it('shares only visible, non-sensitive structured records when both agents opt in', async () => {
    upsertMemoryRecord({
      id: 'research-shared',
      providerId: 'local',
      kind: 'preference',
      agentId: 'research',
      workspaceId: '/workspace/research',
      content: 'Use the nebula release checklist.',
      sensitivity: 'normal',
    });
    upsertMemoryRecord({
      id: 'research-secret',
      providerId: 'local',
      kind: 'boundary',
      agentId: 'research',
      workspaceId: '/workspace/research',
      content: 'Nebula production token is secret.',
      sensitivity: 'secret',
    });
    upsertMemoryRecord({
      id: 'research-session',
      providerId: 'local',
      kind: 'project_context',
      agentId: 'research',
      sessionKey: 'agent:research:webchat:default:dm:other',
      content: 'Nebula private session detail.',
    });
    const manager = await managerFor(config('readOnly', 'readOnly'));

    const hits = await manager.search({
      query: 'nebula',
      scope: {
        agentId: 'main',
        workspaceId: '/workspace/main',
        sessionKey: 'agent:main:webchat:default:dm:user',
      },
      maxResults: 10,
    });

    expect(hits.map((hit) => hit.record.id)).toContain('research-shared');
    expect(hits.map((hit) => hit.record.id)).not.toContain('research-secret');
    expect(hits.map((hit) => hit.record.id)).not.toContain('research-session');
  });

  it('does not return foreign records when either agent denies sharing', async () => {
    upsertMemoryRecord({
      id: 'research-private',
      providerId: 'local',
      kind: 'preference',
      agentId: 'research',
      content: 'Use the comet workflow.',
    });
    const manager = await managerFor(config('readOnly', 'deny'));

    expect(await manager.search({ query: 'comet', maxResults: 10 })).toEqual([]);
  });

  it('allows bilateral allow to submit a candidate without modifying actor Markdown', async () => {
    const manager = await managerFor(config('allow', 'allow'));

    const result = await manager.write({
      kind: 'project_context',
      content: 'Research should evaluate the solar migration plan.',
      status: 'candidate',
      scope: { agentId: 'research' },
      source: { provider: 'cross-agent-test' },
    });

    expect(result.success).toBe(true);
    expect(result.record?.scope.agentId).toBe('research');
    expect(result.record?.status).toBe('candidate');
    expect(result.record?.tags).toContain('shared-from:main');
    expect(listMemoryRecords({ agentId: 'research', status: 'candidate' })).toHaveLength(1);
    expect(existsSync(join(root, 'agents/main/memories/MEMORY.md'))).toBe(false);
  });
});
