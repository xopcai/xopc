import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { listKnowledgeItems, deleteKnowledgeItem, canUseKnowledge } from '../../knowledge-memory/index.js';
import { MemoryLearningService } from '../service.js';
import { bindOwnerIdentity } from '../../user-context/identity-bindings.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { claimLearningJob, enqueueConversationLearning, failLearningJob, finishLearningJob } from '../repository.js';
import { applyWorkCandidates, type WorkCandidate } from '../work-capture.js';

const id = '4dffa204-0300-4d2d-89ce-55305490c550';
const config = ConfigSchema.parse({});
function seed(source = 'webchat'): void {
  ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: source, sourceChatId: 'owner', sessionType: 'chat',
    routing: { agentId: 'main', source, accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
  appendTranscriptEntry(id, { role: 'user', content: 'Atlas 使用 SQLite，因为需要本地部署。', timestamp: Date.now() });
  appendTranscriptEntry(id, { role: 'assistant', content: '已实现。', timestamp: Date.now(), stopReason: 'stop' } as never);
}
const candidate: WorkCandidate = { kind: 'decision', topicKey: 'atlas', predicate: 'storage.choice',
  statement: 'Atlas 使用 SQLite，因为需要本地部署。', scope: 'workspace', confidence: 0.8, importance: 0.8,
  evidence: [{ ref: 'user-1', quote: '使用 SQLite' }] };

describe('persistent memory learning', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  it('recovers idle short conversations without an in-memory turn counter', () => {
    seed();
    const now = Date.now();
    expect(enqueueConversationLearning(config, id, '/workspace', false, now)).toBeTypeOf('string');
    expect(claimLearningJob(now)).toBeUndefined();
    const job = claimLearningJob(now + 60_001)!;
    expect(job).toBeDefined();
    expect(enqueueConversationLearning(config, id, '/workspace', false, now)).toBeUndefined();
    expect(finishLearningJob(job, () => {})).toBe(true);
    expect(enqueueConversationLearning(config, id, '/workspace', false, now + 60_002)).toBeUndefined();
  });

  it('recovers work directly from persisted rows during the service scan', async () => {
    seed();
    getSqliteDatabase().prepare('UPDATE transcript_entries SET created_at = ?').run(Date.now() - 61_000);
    let executed = 0;
    const service = new MemoryLearningService({ getConfig: () => config, workspaceForSession: () => '/workspace',
      execute: async job => { executed += 1; finishLearningJob(job, () => {}); } });
    await service.runNow(); service.stop();
    expect(executed).toBe(1);
    expect(getSqliteDatabase().prepare('SELECT state FROM memory_learning_jobs').get()).toMatchObject({ state: 'succeeded' });
  });

  it('queues the next bounded batch atomically instead of waiting for another interactive turn', () => {
    seed(); enqueueConversationLearning(config, id, '/workspace', true);
    const job = claimLearningJob()!;
    finishLearningJob(job, () => {}, job.through_seq - 1);
    expect(claimLearningJob()).toMatchObject({ start_seq: job.through_seq - 1, through_seq: job.through_seq });
  });

  it('rejects a stale worker after another worker recovers its lease', () => {
    seed(); enqueueConversationLearning(config, id, '/workspace', true);
    const first = claimLearningJob()!;
    getSqliteDatabase().prepare('UPDATE memory_learning_jobs SET lease_until = 0 WHERE job_id = ?').run(first.job_id);
    const second = claimLearningJob()!;
    let writes = 0;
    expect(finishLearningJob(first, () => { writes += 1; })).toBe(false);
    expect(finishLearningJob(second, () => { writes += 1; })).toBe(true);
    expect(writes).toBe(1);
  });

  it('rolls back both memory effects and progress when applying results fails', () => {
    seed(); enqueueConversationLearning(config, id, '/workspace', true);
    const job = claimLearningJob()!;
    expect(() => finishLearningJob(job, () => {
      getSqliteDatabase().prepare('UPDATE memory_learning_cursors SET processed_seq = 99').run();
      throw new Error('commit failed');
    })).toThrow('commit failed');
    expect(getSqliteDatabase().prepare('SELECT processed_seq FROM memory_learning_cursors').get()).toMatchObject({ processed_seq: 0 });
    failLearningJob(job, 'test_failure');
    expect(getSqliteDatabase().prepare('SELECT state FROM memory_learning_jobs').get()).toMatchObject({ state: 'retry_wait' });
  });

  it('requires explicit owner binding for channel direct messages and preserves temporary mode', () => {
    seed('telegram');
    expect(resolveUserContextSessionAccess(config, id).enabled).toBe(false);
    bindOwnerIdentity({ channel: 'telegram', accountId: 'default', peerId: 'owner' });
    expect(resolveUserContextSessionAccess(config, id).enabled).toBe(true);
    setSessionConfig(id, { userContextMode: 'temporary' }, '/tmp');
    expect(enqueueConversationLearning(config, id, '/workspace', true)).toBeUndefined();
  });

  it('admits grounded decisions, retains scope, and cannot recreate deleted knowledge', () => {
    const input = { candidates: [candidate], evidence: [{ ref: 'user-1', role: 'user' as const,
      text: 'Atlas 使用 SQLite，因为需要本地部署。', createdAt: Date.now() }], conversationId: id, agentId: 'main',
      workspaceId: '/workspace', processingPolicy: 'remote_allowed' as const, runId: 'run-1' };
    expect(applyWorkCandidates(input)[0]?.outcome).toBe('created');
    const memory = listKnowledgeItems()[0]!;
    expect(memory).toMatchObject({ status: 'active', scope: { type: 'workspace', id: '/workspace' } });
    deleteKnowledgeItem(memory.id);
    expect(applyWorkCandidates(input)[0]?.outcome).toBe('rejected');
  });

  it('keeps assistant-only claims tentative and rejects invented quotes', () => {
    const input = { candidates: [candidate], evidence: [{ ref: 'user-1', role: 'assistant' as const,
      text: '使用 SQLite', createdAt: Date.now() }], conversationId: id, agentId: 'main', workspaceId: '/workspace',
      processingPolicy: 'remote_allowed' as const, runId: 'run-1' };
    applyWorkCandidates(input);
    expect(listKnowledgeItems()[0]).toMatchObject({ status: 'candidate', verification: 'tentative' });
    expect(applyWorkCandidates({ ...input, candidates: [{ ...candidate, evidence: [{ ref: 'user-1', quote: 'invented' }] }] })[0]?.outcome).toBe('rejected');
  });

  it('stops recalling derived channel knowledge immediately after an owner binding is revoked', () => {
    seed('telegram');
    bindOwnerIdentity({ channel: 'telegram', accountId: 'default', peerId: 'owner' });
    applyWorkCandidates({ candidates: [candidate], evidence: [{ ref: 'user-1', role: 'user', text: '使用 SQLite', createdAt: Date.now() }],
      conversationId: id, agentId: 'main', workspaceId: '/workspace', processingPolicy: 'remote_allowed', runId: 'test' });
    const memory = listKnowledgeItems()[0]!;
    const context = { agentId: 'main', workspaceId: '/workspace', conversationId: id };
    expect(canUseKnowledge(memory, context)).toBe(true);
    getSqliteDatabase().prepare('UPDATE owner_identity_bindings SET revoked_at = ?').run(Date.now());
    expect(canUseKnowledge(memory, context)).toBe(false);
  });
});
