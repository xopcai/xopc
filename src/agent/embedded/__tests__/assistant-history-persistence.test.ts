import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createAgentSession, DefaultResourceLoader, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../config/schema.js';
import { recordPromptCacheTouch } from '../../../providers/prompt-cache-lifecycle.js';
import { SessionStore } from '../../../session/store.js';
import { onSessionTranscriptUpdate } from '../../../session/transcript-events.js';
import { closeXopcDatabase, ensureSessionRecord, loadTranscriptRowsForSession, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { openSqliteHydratingSessionManager } from '../sqlite-hydrating-session-manager.js';
import { guardSessionManager } from '../session-tool-result-guard.js';
import { subscribeEmbeddedSessionEvents } from '../subscribe-session.js';

const conversationId = '473d91dc-aafc-45a0-99ad-a9b53dab9e64';

describe('assistant history persistence at the native event boundary', () => {
  let directory: string;
  let previousStateDir: string | undefined;
  let session: AgentSession | undefined;
  let store: SessionStore;
  let unsubscribe: (() => void) | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'xopc-history-boundary-'));
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = directory;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: directory }] });
    store = new SessionStore({ config: ConfigSchema.parse({}) });
    await store.initialize();
  });
  afterEach(async () => {
    unsubscribe?.(); session?.dispose();
    unsubscribe = undefined; session = undefined;
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    await rm(directory, { recursive: true, force: true });
  });

  it.each([undefined, null])('keeps all replies in SQLite history when optional cache usage is %s', async usage => {
    const created = ensureSessionRecord(conversationId, directory, { agentId: 'main' });
    const manager = guardSessionManager(openSqliteHydratingSessionManager({ conversationId, cwd: directory,
      transcriptId: created.transcriptId! }), { conversationId });
    const writes: Promise<void>[] = [];
    unsubscribe = onSessionTranscriptUpdate(update => { writes.push(store.syncEmbeddedTranscriptUpdate(update)); });
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager,
      noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true });
    await resourceLoader.reload();
    const model = getModel('openai', 'gpt-6-sol');
    ({ session } = await createAgentSession({ cwd: directory, agentDir: directory, model,
      settingsManager, resourceLoader, sessionManager: manager, noTools: 'builtin' }));
    const visibleReplies: string[] = [];
    const stop = subscribeEmbeddedSessionEvents(session, event => {
      if (event.type === 'message_update' && event.message.role === 'assistant') {
        visibleReplies.push(JSON.stringify(event.message.content));
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        recordPromptCacheTouch(conversationId, model, event.message.usage);
      }
    });
    // Dispatch through the installed native SDK handler, including its listener-before-append ordering.
    const handle = (session as unknown as { _handleAgentEvent: (event: AgentEvent) => Promise<void> })._handleAgentEvent;
    const failures: string[] = [];
    try {
      for (let turn = 0; turn < 3; turn++) {
        manager.setActiveTurnId?.(`turn-${turn}`);
        await handle({ type: 'message_end', message: { role: 'user', content: `question-${turn}`, timestamp: turn * 2 } });
        // The sync method must commit before the transcript-updated observer can read history.
        expect(loadTranscriptRowsForSession(conversationId).filter(row => 'role' in row && row.role === 'user')).toHaveLength(turn + 1);
        const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
          content: [{ type: 'text', text: `answer-${turn}` }], stopReason: 'stop', timestamp: turn * 2 + 1, usage };
        await handle({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', contentIndex: 0,
          delta: `answer-${turn}`, partial: message } } as unknown as AgentEvent);
        try { await handle({ type: 'message_end', message } as unknown as AgentEvent); }
        catch (error) { failures.push(String(error)); }
        await Promise.all(writes);
        const page = await store.getMessagePage(conversationId, { includeContextRows: true, limit: 50 });
        if (failures.length === 0) expect(page!.session.messages.filter(row => row.role === 'assistant').map(row => row.content))
          .toEqual(Array.from({ length: turn + 1 }, (_, index) => `answer-${index}`));
      }
      expect(visibleReplies).toHaveLength(3);
      const page = await store.getMessagePage(conversationId, { includeContextRows: true, limit: 50 });
      expect(page!.session.messages.filter(row => row.role === 'user')).toHaveLength(3);
      expect(failures).toEqual([]);
      expect(page!.session.messages.filter(row => row.role === 'assistant')).toHaveLength(3);
    } finally { stop(); }
  });
});
