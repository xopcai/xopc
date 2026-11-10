import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservationCommandRequest } from '@xopcai/gateway-contract';

import { appendTranscriptEntry, closeXopcDatabase, getXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { observationStarters } from '../observation-starters.js';
import { HomeObservation } from '../observation.js';
import { HomeIntelligenceHost } from '../host.js';
import { HomeSnapshotBuilder, type HomeContextSnapshot } from '../snapshot.js';
import { TaskRepository } from '../../tasks/task-repository.js';

const principal = { ownerId: 'owner', workspaceId: 'workspace' };
const now = Date.now();
function source(text = '整理项目周报') {
  const id = randomUUID();
  createConversation({ agentId: 'main', sourceChannel: 'webchat', name: '项目周报', routing: { source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner', agentId: 'main' } }, '', id);
  appendTranscriptEntry(id, { role: 'user', content: text, timestamp: now });
  return id;
}
function cmd(o: HomeObservation, command: ObservationCommandRequest['command'], at = now) {
  return o.command({ command, expectedRevision: o.state().revision, idempotencyKey: randomUUID() }, at);
}
function observer(canRead = (_id: string) => true) { return new HomeObservation(getXopcDatabase().db, principal, canRead); }

describe('long-term Home observation', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  it('extracts actual user requests before truncation and repairs old context-only excerpts on read',()=>{
    const wrapped=`<source_contexts>\n<source_context kind="device_context">${'Frozen device metadata. '.repeat(150)}</source_context>\n</source_contexts>\n\n<user_message>\n[2026-11-10 13:45 GMT+8] 审查 today-cloud PR 10766\n</user_message>`;
    source(wrapped);source('Review PR 11622');source('hello');
    const o=observer();cmd(o,{kind:'start',backfillDays:30});o.collect(now);
    const entries=o.state().topics.flatMap(t=>t.entries);
    expect(entries.some(e=>e.text==='审查 today-cloud PR 10766')).toBe(true);
    expect(JSON.stringify(o.context(now))).not.toContain('device_context');
    const original=entries.find(e=>e.text.includes('10766'))!;
    getXopcDatabase().db.prepare('UPDATE home_observation_entries SET text=? WHERE id=?').run(wrapped.slice(0,1000),original.id);
    expect(o.state().topics.flatMap(t=>t.entries).find(e=>e.id===original.id)!.text).toBe('审查 today-cloud PR 10766');
    const starters=observationStarters(o.state());
    expect(starters).toHaveLength(1);expect(starters[0]).toMatchObject({kind:'pr_review',requestCount:2});
    cmd(o,{kind:'pause'});expect(observationStarters(o.state())).toEqual([]);
  });

  it('recovers authoritative rows without notifications and does not count replays', () => {
    source(); const first = observer(); cmd(first, { kind: 'start', backfillDays: 30 });
    expect(first.collect(now + 1)).toBe(true);
    const restored = observer();
    expect(restored.collect(now + 2)).toBe(false);
    expect(restored.state().topics[0]?.entries).toHaveLength(1);
    expect(restored.state().id).toBe(first.state().id);
    expect(getXopcDatabase().db.prepare('SELECT COUNT(*) AS n FROM memory_learning_cursors').get()?.n).toBe(0);
  });

  it('keeps scoped feedback across restarts and retracts it without promoting one-off feedback', () => {
    source(); const o = observer(); cmd(o, { kind: 'start', backfillDays: 30 }); o.collect(now);
    const topicId = o.state().topics[0]!.id;
    cmd(o, { kind: 'feedback', topicId, text: '仅本次使用这个格式', scope: 'once' });
    cmd(o, { kind: 'feedback', topicId, text: '只在发布期需要周报', scope: 'similar' });
    const restored = observer();
    expect(restored.context(now).feedback.map(f => f.text)).toEqual(['只在发布期需要周报']);
    expect(restored.trialFeedback(topicId)).toHaveLength(2);
    const feedback = restored.state().topics[0]!.feedback.find(f => f.scope === 'similar')!;
    cmd(restored, { kind: 'retract', topicId, feedbackId: feedback.id });
    expect(restored.context(now).feedback).toEqual([]);
    expect(restored.state().topics[0]!.feedback.find(f => f.id === feedback.id)?.status).toBe('retracted');
  });

  it('pauses ingestion, supports new-only resume, and excludes a forgotten source topic', () => {
    const id = source(); const o = observer(); cmd(o, { kind: 'start', backfillDays: 30 }); o.collect(now);
    const topicId = o.state().topics[0]!.id;
    cmd(o, { kind: 'pause' });
    appendTranscriptEntry(id, { role: 'user', content: '暂停期间记录', timestamp: now + 10 });
    expect(o.collect(now + 15)).toBe(false);
    cmd(o, { kind: 'resume', mode: 'new_only' }, now + 20);
    o.collect(now + 21);
    expect(o.state().topics[0]!.entries.map(e => e.text)).not.toContain('暂停期间记录');
    cmd(o, { kind: 'forget', topicId }, now + 22);
    appendTranscriptEntry(id, { role: 'user', content: '之后仍在做周报', timestamp: now + 30 });
    o.collect(now + 31);
    expect(o.state().topics).toEqual([]);
    expect(getXopcDatabase().db.prepare('SELECT COUNT(*) AS n FROM home_observation_entries').get()?.n).toBe(0);
    expect(getXopcDatabase().db.prepare('SELECT COUNT(*) AS n FROM transcript_entries').get()?.n).toBe(3);
  });

  it('honors access revocation, excludes secrets, and fences stale control requests', () => {
    const id = source('api_key=sk-secret-key-for-testing'); let allowed = true;
    const o = observer(() => allowed); cmd(o, { kind: 'start', backfillDays: 30 }); o.collect(now);
    expect(o.state().topics).toEqual([]);
    appendTranscriptEntry(id, { role: 'user', content: '准备周报草稿', timestamp: now + 1 }); o.collect(now + 2);
    allowed = false; expect(o.state().topics).toEqual([]);
    expect(() => o.command({ command: { kind: 'pause' }, expectedRevision: 0, idempotencyKey: 'stale' })).toThrow('revision');
  });

  it('replays identical controls but rejects changed payloads using the same key', () => {
    const o = observer(); const request = { command: { kind: 'start' as const, backfillDays: 30 }, expectedRevision: 0, idempotencyKey: 'start' };
    expect(o.command(request).id).toBe(o.command(request).id);
    expect(() => o.command({ ...request, command: { kind: 'pause' } })).toThrow('key already used');
  });

  it('restores the same observation identity, feedback and progress after reopening the on-disk database', () => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    const dir = mkdtempSync(join(tmpdir(), 'xopc-observation-'));
    try {
      openXopcDatabase({ path: join(dir, 'state.db') });
      const id = source(); const o = observer(); cmd(o, { kind: 'start', backfillDays: 30 }); o.collect(now);
      const topicId = o.state().topics[0]!.id;
      cmd(o, { kind: 'feedback', topicId, scope: 'similar', text: '只在发布期需要' });
      const sessionId = o.state().id;
      closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
      openXopcDatabase({ path: join(dir, 'state.db') });
      const restored = observer(); expect(restored.state().id).toBe(sessionId);
      expect(restored.collect(now)).toBe(false);
      expect(restored.context(now).feedback[0]?.text).toBe('只在发布期需要');
      appendTranscriptEntry(id, { role: 'user', content: '新的发布周期任务', timestamp: now + 1 });
      expect(restored.collect(now + 2)).toBe(true);
      expect(restored.state().topics).toHaveLength(1);
    } finally { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not commit an in-flight interpretation after observation is paused', async () => {
    source(); const publish = vi.fn();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const generate = vi.fn(async () => { await pending; return { modelRef: 'test/model', usage: {},
      result: { state: 'quiet' as const, reason: 'insufficient_value' as const } }; });
    const host = new HomeIntelligenceHost(getXopcDatabase().db, { principal, canObserve: () => true, generator: { generate }, now: () => now,
      snapshot: new HomeSnapshotBuilder({ projects: () => [], tasks: () => [], knowledge: () => [] }),
      capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: () => ({ capabilities: [], preflight: { state: 'ready' } }), publish, notifyOpportunity: vi.fn(), locale: () => 'zh' });
    cmd(host.observation, { kind: 'start', backfillDays: 30 });
    host.requestRefresh('observation_changed', 'inflight');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    cmd(host.observation, { kind: 'pause' }); release();
    await vi.waitFor(() => expect(getXopcDatabase().db.prepare("SELECT COUNT(*) AS n FROM home_advice_generations WHERE status='running'").get()?.n).toBe(0));
    expect(host.observation.state().analyzedRevision).toBe(0);
    await host.tick(); expect(generate).toHaveBeenCalledOnce();
    expect(publish.mock.calls.some(call => call[1]?.state === 'quiet')).toBe(false);
  });

  it('carries feedback into grounded model input and creates exactly one private trial Task', async () => {
    source(); const db = getXopcDatabase().db;
    const generate = vi.fn(async (snapshot: HomeContextSnapshot) => ({ modelRef: 'test/model', usage: {}, result: {
      state: 'ready' as const, candidates: [{ kind: 'project_next_step' as const, title: '整理周报草稿', outcome: '私人周报草稿', rationale: '根据当前任务和反馈整理',
        evidenceIds: [snapshot.evidence[0]!.id], confidence: 'high' as const, urgency: 'today' as const,
        risk: 'analysis' as const, proposedSteps: ['汇总进展'], requiredCapabilities: [], verification: ['每项有来源'], actionPrompt: '整理周报，附来源链接。' }],
    } }));
    const host = new HomeIntelligenceHost(db, { principal, canObserve: () => true, generator: { generate }, now: () => now,
      snapshot: new HomeSnapshotBuilder({ projects: () => [], tasks: () => [], knowledge: () => [] }), capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: () => ({ capabilities: [], preflight: { state: 'ready' } }), publish: vi.fn(), notifyOpportunity: vi.fn(), locale: () => 'zh' });
    cmd(host.observation, { kind: 'start', backfillDays: 30 });
    host.requestRefresh('observation_changed', 'initial');
    await vi.waitFor(() => expect(host.getAdvisor().state).toBe('ready'));
    const topicId = host.observation.state().topics[0]!.id;
    cmd(host.observation, { kind: 'feedback', topicId, scope: 'similar', text: '只在发布期需要' });
    host.requestRefresh('observation_changed', 'feedback');
    await vi.waitFor(() => expect(host.observation.state().analyzedRevision).toBe(host.observation.state().revision));
    expect(generate.mock.calls.at(-1)![0].observation?.feedback[0]?.text).toBe('只在发布期需要');
    const advisor = host.getAdvisor(); if (advisor.state !== 'ready') throw Error('No grounded suggestion');
    const request = { topicId, opportunityId: advisor.primary.id, expectedOpportunityRevision: advisor.primary.revision,
      expectedRevision: host.observation.state().revision, idempotencyKey: 'trial' };
    const result = host.trial(request); expect(host.trial(request)).toEqual(result);
    expect(new TaskRepository().list()).toHaveLength(1);
    if (result.outcome !== 'task') throw Error('No trial');
    const task = new TaskRepository().get(result.taskId)!;
    expect(task.contract?.constraints.join(' ')).toContain('private draft only');
    expect(task.contract?.constraints.join(' ')).toContain('只在发布期需要');
    expect(host.observation.state().topics[0]!.trials[0]?.taskId).toBe(result.taskId);
    const runId = db.prepare('SELECT run_id FROM task_runs WHERE task_id=?').get(result.taskId)!.run_id as string;
    db.prepare("UPDATE task_runs SET status='succeeded' WHERE run_id=?").run(runId);
    db.prepare(`INSERT INTO task_run_receipts(run_id,status,summary,completion_verdict,finalized_at) VALUES (?,'succeeded',?,'achieved',?)`)
      .run(runId,'私人草稿已生成，来源检查通过',now);
    expect(host.observation.collect(now)).toBe(true);
    expect(host.observation.state().topics[0]!.entries.some(e => e.kind === 'trial_result' && e.text.includes('achieved'))).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM automations').get()?.n).toBe(0);
    cmd(host.observation, { kind: 'forget', topicId });
    expect(db.prepare('SELECT COUNT(*) AS n FROM home_opportunity_projections').get()?.n).toBe(0);
    expect(new TaskRepository().get(result.taskId)).toBeDefined();
  });
});
