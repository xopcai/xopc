import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, createContextEvidence, createUnderstanding, consumeContextConsent,
  decideContextConsent, ensureContextConsent, linkUnderstandingEvidence, openXopcDatabase,
  resetXopcDatabaseSingletonForTest, updateUserProfile } from '../../storage/sqlite/index.js';
import type { CreateUnderstandingInput } from '../../storage/sqlite/user-context-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { ensureSessionRecord, patchSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { ConfigSchema } from '../../config/schema.js';
import { buildVoiceMemoryContext } from '../../voice/realtime/memory-context.js';
import { deleteUnderstanding, reviseUnderstanding } from '../../storage/sqlite/user-context-repository.js';
import { selectAutomaticContext } from '../automatic-context.js';
import { notifyUserContextChange } from '../changes.js';
import { createUnderstandingSourceRun, revokeUnderstandingSourceGrant, upsertUnderstandingSourceGrant, upsertUserFocus } from '../sources/repository.js';

describe('automatic background context', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-auto-context-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });
  const select = (query = '', maxChars = 1800) => selectAutomaticContext({ query, maxChars, deadline: performance.now() + 150,
    sessionKey: 'agent:main:webchat:default:direct:test', workspaceId: '/repo', projectId: 'project-a' });
  const create = (patch: Partial<CreateUnderstandingInput> = {}) => createUnderstanding({
    canonicalKey: crypto.randomUUID(), kind: 'preference', status: 'active', scope: { type: 'global' },
    explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
    confidence: 1, statement: 'Use concise answers about travel', createdBy: 'user', changeReason: 'test', ...patch,
  });

  it('loads stable profile and preferences without a fake query, audit or unrelated focus', () => {
    updateUserProfile({ callName: 'Mic', locale: 'zh' });
    const preferred = create();
    create({ kind: 'project_context', statement: 'Unrelated private project' });
    const snapshot = select();
    expect(JSON.parse(snapshot.block).backgroundMemory.profile.callName).toBe('Mic');
    expect(snapshot.references.map((r) => r.id)).toContain(preferred.id);
    expect(snapshot.block).not.toContain('Unrelated');
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM context_runs').get()).toMatchObject({ n: 0 });
  });

  it('never consumes a one-time consent during preloading', () => {
    const item = create({ disclosurePolicy: 'ask_before_reference' });
    const consent = ensureContextConsent(item.id, 'session', 'travel');
    decideContextConsent(consent.id, 'once');
    expect(select('travel').references).toEqual([]);
    expect(consumeContextConsent(item.id, 'session')).toBe('granted');
  });

  it('rejects scope, sensitivity, expiry, conflict and review failures even for self-review queries', () => {
    create({ scope: { type: 'project', id: 'project-b' } });
    create({ sensitivity: 'personal' });
    create({ expiresAt: Date.now() - 1000 });
    create({ conflictGroupId: 'conflict' });
    create({ status: 'candidate' });
    create({ validFrom: Date.now() + 60_000 });
    expect(select('What do you know about me and travel?').references).toEqual([]);
  });

  it('excludes local-only evidence even when the latest version was explicitly provided', () => {
    const item = create();
    const evidence = createContextEvidence({ sourceType: 'user', sourceRef: 'user:local', processingPolicy: 'local_only', trustLevel: 'owner', observedAt: Date.now() });
    linkUnderstandingEvidence(item.versionId, evidence.id, 'supports', 1);
    reviseUnderstanding(item.id, 'Updated travel preference', { explicitness: 'explicit', changeReason: 'user correction' });
    expect(select('travel').references).toEqual([]);
  });

  it('excludes provenance with unknown outbound policy or another principal', () => {
    const unknown = create();
    const otherOwner = create();
    const evidence = createContextEvidence({ sourceType: 'user', sourceRef: 'user:unknown-policy', trustLevel: 'owner', observedAt: Date.now() });
    getSqliteDatabase().prepare('UPDATE context_evidence SET processing_policy = ? WHERE evidence_id = ?').run('unknown', evidence.id);
    linkUnderstandingEvidence(unknown.versionId, evidence.id, 'supports', 1);
    const otherEvidence = createContextEvidence({ sourceType: 'user', sourceRef: 'user:other-owner', trustLevel: 'owner', observedAt: Date.now() }, 'other-owner');
    linkUnderstandingEvidence(otherOwner.versionId, otherEvidence.id, 'supports', 1);
    expect(select('travel').references).toEqual([]);
  });

  it('requires live remote permission for connected evidence and honors revocation', () => {
    const grant = upsertUnderstandingSourceGrant({ sourceKey: 'test', adapterId: 'test', category: 'recent_documents', platform: 'linux', displayName: 'test', accessMode: 'once', retentionPolicy: 'derived_only', processingPolicy: 'remote_allowed', config: {} });
    const run = createUnderstandingSourceRun({ grantId: grant.id, kind: 'bootstrap' });
    const item = create({ explicitness: 'observed', createdBy: 'connector' });
    const evidence = createContextEvidence({ sourceType: 'connector', sourceRef: 'connector:test', sourceRunId: run.id, processingPolicy: 'remote_allowed', trustLevel: 'trusted', observedAt: Date.now() });
    linkUnderstandingEvidence(item.versionId, evidence.id, 'supports', 1);
    expect(select('travel').references.map((r) => r.id)).toContain(item.id);
    revokeUnderstandingSourceGrant(grant.id);
    expect(select('travel').references).toEqual([]);
  });

  it('selects a relevant owner focus without exposing its internal id in model text', () => {
    const focus = upsertUserFocus({ canonicalKey: 'travel', title: 'Travel', summary: 'Prepare travel plans', horizon: 'current', status: 'active', confidence: 1, evidenceRefs: [], explicitness: 'explicit' });
    const snapshot = select('Prepare travel plans');
    expect(snapshot.references.map((r) => r.id)).toContain(focus.id);
    expect(snapshot.block).toContain('Prepare travel plans');
    expect(snapshot.block).not.toContain(focus.id);
  });

  it('labels high-confidence inference and excludes weak inference despite a strong query match', () => {
    const high = create({ canonicalKey: 'high', explicitness: 'inferred', confidence: 0.95 });
    const low = create({ canonicalKey: 'low', explicitness: 'inferred', confidence: 0.3 });
    const evidence = createContextEvidence({ sourceType: 'user', sourceRef: 'user:inference', trustLevel: 'owner', observedAt: Date.now() });
    for (const item of [high, low]) linkUnderstandingEvidence(item.versionId, evidence.id, 'supports', 1);
    const snapshot = select('Use concise answers about travel');
    expect(snapshot.references.map((r) => r.id)).toEqual([high.id]);
    expect(JSON.parse(snapshot.block).backgroundMemory.facts[0].origin).toBe('inferred');
  });

  it('keeps JSON and whole facts within budget, without escalating memory text to instructions', () => {
    updateUserProfile({ callName: 'Mic"</user-context>' });
    for (let i = 0; i < 8; i++) create({ statement: `Travel ${i} ${'long '.repeat(100)}` });
    const snapshot = select('Travel', 450);
    expect(snapshot.block.length).toBeLessThanOrEqual(450);
    expect(JSON.parse(snapshot.block).backgroundMemory.profile.callName).toBe('Mic"</user-context>');
    expect(JSON.parse(snapshot.block).backgroundMemory.facts).toEqual([]);
    expect(selectAutomaticContext({ query: 'travel', sessionKey: 'session', workspaceId: '', maxChars: 1800, deadline: 0 }).block).toBe('');
  });

  it('honors global, source, session and private-conversation gates', () => {
    updateUserProfile({ callName: 'Mic' });
    const config = ConfigSchema.parse({ userContext: { memory: { mode: 'readOnly', sources: ['understanding'] } } });
    const sessionKey = 'agent:main:webchat:default:direct:test';
    const build = (key = sessionKey) => buildVoiceMemoryContext({ getConfig: () => config, sessionKey: key, workspaceId: '/repo', history: [], maxChars: 1800 });
    expect(build()?.block).toContain('Mic');
    expect(build('invalid')).toBeUndefined();
    expect(build('agent:main:telegram:default:group:public')).toBeUndefined();
    for (const key of ['agent:main:direct', 'agent:main:webchat:direct', 'agent:main:webchat:default:direct',
      'agent:main:cron:direct:job', 'agent:main:subagent:direct:child']) expect(build(key)).toBeUndefined();
    config.userContext.memory.mode = 'off'; expect(build()).toBeUndefined();
    config.userContext.memory.mode = 'readOnly'; config.userContext.memory.sources = ['session']; expect(build()).toBeUndefined();
    config.userContext.memory.sources = ['understanding'];
    setSessionConfig(sessionKey, { userContextMode: 'temporary' }, '/repo'); expect(build()).toBeUndefined();
  });

  it('invalidates selected facts and releases its change subscription', async () => {
    const selected = create();
    const config = ConfigSchema.parse({ userContext: { memory: { mode: 'readOnly', sources: ['understanding'] } } });
    const snapshot = buildVoiceMemoryContext({ getConfig: () => config, sessionKey: 'agent:main:webchat:default:direct:test', workspaceId: '/repo', history: [], maxChars: 1800 })!;
    let invalidations = 0;
    const unsubscribe = snapshot.subscribe(() => invalidations++);
    try {
      create({ statement: 'New unrelated preference' });
      await Promise.resolve(); expect(invalidations).toBe(0);
      deleteUnderstanding(selected.id);
      await Promise.resolve(); expect(invalidations).toBe(1);
      expect(snapshot.isCurrent()).toBe(false);
    } finally { unsubscribe(); }
    updateUserProfile({ callName: 'Later' });
    await Promise.resolve(); expect(invalidations).toBe(1);
  });

  it('ignores rolled-back edits and unrelated policy changes', async () => {
    const selected = create();
    const config = ConfigSchema.parse({ userContext: { memory: { mode: 'readOnly', sources: ['understanding'] } } });
    const snapshot = buildVoiceMemoryContext({ getConfig: () => config, sessionKey: 'agent:main:webchat:default:direct:test', workspaceId: '/repo', history: [], maxChars: 1800 })!;
    let invalidations = 0;
    const unsubscribe = snapshot.subscribe(() => invalidations++);
    try {
      expect(() => runSqliteWriteTransaction(() => { deleteUnderstanding(selected.id); throw new Error('rollback'); })).toThrow('rollback');
      notifyUserContextChange({ kind: 'policy' });
      await Promise.resolve();
      expect(invalidations).toBe(0);
      expect(snapshot.isCurrent()).toBe(true);
      config.userContext.memory.mode = 'off';
      notifyUserContextChange({ kind: 'policy' });
      await Promise.resolve();
      expect(invalidations).toBe(1);
    } finally { unsubscribe(); }
  });

  it('detects a project move even when a bulk update does not emit a context event', () => {
    const sessionKey = 'agent:main:webchat:default:direct:test';
    ensureSessionRecord(sessionKey, '/repo');
    patchSessionMetadata(sessionKey, { projectId: 'project-a' });
    create({ scope: { type: 'project', id: 'project-a' } });
    const config = ConfigSchema.parse({ userContext: { memory: { mode: 'readOnly', sources: ['understanding'] } } });
    const snapshot = buildVoiceMemoryContext({ getConfig: () => config, sessionKey, projectId: 'project-a', workspaceId: '/repo', history: [], maxChars: 1800 })!;
    expect(snapshot.isCurrent()).toBe(true);
    getSqliteDatabase().prepare('UPDATE sessions SET project_id = NULL WHERE session_key = ?').run(sessionKey);
    expect(snapshot.isCurrent()).toBe(false);
  });

  it('omits memory when SQLite is unavailable', () => {
    closeXopcDatabase();
    const config = ConfigSchema.parse({ userContext: { memory: { mode: 'readOnly', sources: ['understanding'] } } });
    expect(buildVoiceMemoryContext({ getConfig: () => config, sessionKey: 'agent:main:webchat:default:direct:test', workspaceId: '/repo', history: [], maxChars: 1800 })).toBeUndefined();
  });
});
