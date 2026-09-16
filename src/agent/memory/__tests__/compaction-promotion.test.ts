import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("6d9217fe-77c7-411d-8cc9-92aabe81a2d0", '', {"agentId":"main","sourceChannel":"main","sourceChatId":"","sessionType":"chat","routing":{"agentId":"main","source":"main","accountId":"default","peerKind":"direct","peerId":""}});
  ensureFixtureConversation("8dcb9403-0300-4c1e-8c5b-3f7d71f46360", '', {"agentId":"main","sourceChannel":"cron","sourceChatId":"nightly","sessionType":"cron","routing":{"agentId":"main","source":"cron","accountId":"default","peerKind":"direct","peerId":"nightly"}});
}
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { getKnowledgeItem } from '../../../knowledge-memory/index.js';
import type { TranscriptSourceEntry } from '../../../storage/sqlite/transcript-repository.js';
import type { CompactionHandover } from '../../../session/compaction-types.js';
import { promoteCompactionLedger } from '../compaction-promotion.js';

function source(
  entryId: string,
  seq: number,
  row: TranscriptSourceEntry['row'],
): TranscriptSourceEntry {
  return { entryId, seq, row, createdAt: Date.parse('2026-09-01T00:00:00.000Z') + seq };
}

function handover(): CompactionHandover {
  return {
    version: 1,
    sourceThroughSeq: 6,
    items: [
      {
        id: 'clean-decision',
        kind: 'decision',
        text: 'Use SQLite as the durable memory authority.',
        status: 'active',
        sources: [{ entryId: 'assistant-clean', seq: 2 }],
        identifiers: ['SQLite'],
      },
      {
        id: 'tool-constraint',
        kind: 'constraint',
        text: 'The fetched policy requires a remote approval.',
        status: 'active',
        sources: [{ entryId: 'assistant-tool', seq: 5 }],
        identifiers: [],
      },
      {
        id: 'recent-state',
        kind: 'current_state',
        text: 'The current review is halfway complete.',
        status: 'active',
        sources: [{ entryId: 'assistant-clean', seq: 2 }],
        identifiers: [],
      },
    ],
  };
}

describe('compaction ledger promotion', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-compaction-promotion-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stages every ledger item but promotes only trusted durable kinds', () => {
    seedConversationFixtures();
    const sources: TranscriptSourceEntry[] = [
      source('user-clean', 1, { role: 'user', content: 'Use SQLite.', turnId: 'turn-clean', timestamp: 1 } as never),
      source('assistant-clean', 2, { role: 'assistant', content: [{ type: 'text', text: 'Decision recorded.' }], turnId: 'turn-clean' } as never),
      source('user-tool', 3, { role: 'user', content: 'Check the policy.', turnId: 'turn-tool', timestamp: 2 } as never),
      source('tool-result', 4, { role: 'toolResult', toolCallId: 'call-1', toolName: 'web_search', content: 'remote policy' } as never),
      source('assistant-tool', 5, { role: 'assistant', content: [{ type: 'text', text: 'Constraint found.' }], turnId: 'turn-tool' } as never),
    ];
    const result = promoteCompactionLedger({
      conversationId: "6d9217fe-77c7-411d-8cc9-92aabe81a2d0",
      transcriptId: 'session-1',
      sourceAgentId: 'main',
      workspaceId: stateDir,
      handover: handover(),
      audit: { status: 'passed', mode: 'full', missingItemsFound: 0, repaired: false },
      sourceEntries: sources,
      writePolicy: 'allow',
    });

    expect(result.episodicRecordIds).toHaveLength(3);
    expect(result.durableRecordIds).toHaveLength(1);
    expect(getKnowledgeItem(result.durableRecordIds[0]!)).toMatchObject({
      content: 'Use SQLite as the durable memory authority.',
      status: 'active',
      originClass: 'agent',
      derivedFromRecalledContext: false,
    });
    const taintedEpisode = result.episodicRecordIds
      .map((id) => getKnowledgeItem(id))
      .find((record) => record?.content.includes('fetched policy'));
    expect(taintedEpisode).toMatchObject({
      status: 'candidate',
      originClass: 'untrusted',
    });
  });

  it('does not promote clean ledger items from automation sessions', () => {
    seedConversationFixtures();
    const interactive = promoteCompactionLedger({
      conversationId: "6d9217fe-77c7-411d-8cc9-92aabe81a2d0",
      transcriptId: 'session-interactive',
      sourceAgentId: 'main',
      workspaceId: stateDir,
      handover: handover(),
      audit: { status: 'passed', mode: 'full', missingItemsFound: 0, repaired: false },
      sourceEntries: [
        source('assistant-clean', 2, { role: 'assistant', content: 'Decision recorded.', turnId: 'turn-clean' } as never),
      ],
      writePolicy: 'allow',
    });
    const result = promoteCompactionLedger({
      conversationId: "8dcb9403-0300-4c1e-8c5b-3f7d71f46360",
      transcriptId: 'session-cron',
      sourceAgentId: 'main',
      workspaceId: stateDir,
      handover: handover(),
      audit: { status: 'passed', mode: 'full', missingItemsFound: 0, repaired: false },
      sourceEntries: [
        source('assistant-clean', 2, { role: 'assistant', content: 'Decision recorded.', turnId: 'turn-clean' } as never),
      ],
      writePolicy: 'allow',
    });
    expect(result.durableRecordIds).toEqual([]);
    expect(getKnowledgeItem(interactive.durableRecordIds[0]!)?.status).toBe('active');
  });

  it('stages durable knowledge for confirmation and performs no writes when denied', () => {
    seedConversationFixtures();
    const input = {
      conversationId: "6d9217fe-77c7-411d-8cc9-92aabe81a2d0",
      sourceAgentId: 'main',
      workspaceId: stateDir,
      handover: handover(),
      audit: { status: 'passed' as const, mode: 'full' as const, missingItemsFound: 0, repaired: false },
      sourceEntries: [
        source('assistant-clean', 2, { role: 'assistant', content: 'Decision recorded.', turnId: 'turn-clean' } as never),
      ],
    };
    const confirmed = promoteCompactionLedger({
      ...input,
      transcriptId: 'session-confirm',
      writePolicy: 'confirm',
    });
    expect(getKnowledgeItem(confirmed.durableRecordIds[0]!)?.status).toBe('candidate');

    const denied = promoteCompactionLedger({
      ...input,
      transcriptId: 'session-deny',
      writePolicy: 'deny',
    });
    expect(denied).toEqual({
      episodicRecordIds: [],
      durableRecordIds: [],
      rejectedRecordIds: [],
    });
  });
});
