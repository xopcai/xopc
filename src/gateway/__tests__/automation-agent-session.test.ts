import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { ProjectService } from '../../projects/index.js';
import { SessionStore } from '../../session/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { prepareAutomationAgentSession } from '../automation-agent-session.js';

const minimalConfig = ConfigSchema.parse({
  agents: {
    default: 'main',
    list: [{
      id: 'main',
      profile: { name: 'Main' },
      workspace: '~/default-ws',
    }],
  },
});

describe('prepareAutomationAgentSession', () => {
  let stateDir: string;
  let store: SessionStore;
  let projects: ProjectService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-automation-session-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    store = new SessionStore({ config: minimalConfig });
    projects = new ProjectService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists project ownership and automation routing metadata', async () => {
    const project = projects.create({ name: 'Automation Project' });
    const conversationId = "e300a857-a7cf-456e-8b1d-d6bfc8ad2844";

    await prepareAutomationAgentSession(store, projects, {
      conversationId,
      projectId: project.id,
      agentId: 'main',
      peerId: 'automation-1-run-1',
      automationId: 'automation-1',
      runId: 'run-1',
    });

    await expect(store.getMetadata(conversationId)).resolves.toMatchObject({
      projectId: project.id,
      sourceChannel: 'automation',
      sourceChatId: 'default:dm:automation-1-run-1',
      tags: ['automation'],
      routing: {
        agentId: 'main',
        source: 'automation',
        accountId: 'default',
        peerKind: 'dm',
        peerId: 'automation-1-run-1',
      },
      customData: {
        origin: 'automation',
        automationId: 'automation-1',
        latestAutomationRunId: 'run-1',
      },
    });
    expect(projects.listConversationIds(project.id)).toContain(conversationId);
  });

  it('hides new automation shells until output is ready without hiding existing sessions', async () => {
    const conversationId = "2d73ace2-6b0a-4a42-841a-fa5c37ffa41a";
    const input = {
      conversationId, agentId: 'main', peerId: 'new-run',
      automationId: 'automation-1', runId: 'run-1', automationName: 'Daily brief',
    };
    await prepareAutomationAgentSession(store, projects, input);
    expect(await store.getMetadata(conversationId)).toMatchObject({
      hiddenFromSessionList: true,
      name: 'Daily brief',
      messageCount: 0,
      customData: { deferVisibilityUntilOutput: true },
    });
    expect((await store.list()).items.map((s) => s.key)).not.toContain(conversationId);
    await store.appendTranscriptMessage(conversationId, {
      role: 'user', content: 'Summarize today', timestamp: Date.now(),
    });
    expect(await store.getMetadata(conversationId)).toMatchObject({
      hiddenFromSessionList: true, messageCount: 1,
    });
    await store.updateMetadata(conversationId, { name: 'My title', hiddenFromSessionList: false });
    await prepareAutomationAgentSession(store, projects, input);
    expect(await store.getMetadata(conversationId)).toMatchObject({
      hiddenFromSessionList: false, name: 'My title', messageCount: 1,
    });
    expect((await store.list()).items.map((s) => s.key)).toContain(conversationId);
  });

  it('leaves historical empty sessions visible and unnamed', async () => {
    const conversationId = "73966681-34eb-4553-89db-c79ec0d5f23a";
    await store.resolveTranscriptPath(conversationId, { metadata: { agentId: "main" } });
    await prepareAutomationAgentSession(store, projects, {
      conversationId, agentId: 'main', peerId: 'legacy', automationId: 'old', runId: 'new',
      automationName: 'Daily brief',
    });
    const metadata = await store.getMetadata(conversationId);
    expect(metadata?.hiddenFromSessionList).toBe(false);
    expect(metadata?.name).toBeUndefined();
    expect(metadata?.messageCount).toBe(0);
  });

  it('keeps continuous sessions synchronized when the automation project changes', async () => {
    const first = projects.create({ name: 'First Project' });
    const second = projects.create({ name: 'Second Project' });
    const conversationId = "a34a14ec-4939-45b2-8692-aafb63917c38";
    const base = {
      conversationId,
      agentId: 'main',
      peerId: 'automation-continuous',
      automationId: 'automation-continuous',
    };

    await prepareAutomationAgentSession(store, projects, { ...base, projectId: first.id, runId: 'run-1' });
    await prepareAutomationAgentSession(store, projects, { ...base, projectId: second.id, runId: 'run-2' });
    await expect(store.getMetadata(conversationId)).resolves.toMatchObject({
      projectId: second.id,
      customData: { latestAutomationRunId: 'run-2' },
    });
    expect(projects.listConversationIds(first.id)).not.toContain(conversationId);
    expect(projects.listConversationIds(second.id)).toContain(conversationId);

    await prepareAutomationAgentSession(store, projects, { ...base, runId: 'run-3' });
    await expect(store.getMetadata(conversationId)).resolves.toMatchObject({
      customData: { latestAutomationRunId: 'run-3' },
    });
    expect((await store.getMetadata(conversationId))?.projectId).toBeUndefined();
    expect(projects.listConversationIds(second.id)).not.toContain(conversationId);
  });
});
