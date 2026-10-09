import { createHash, randomUUID } from 'node:crypto';

import { PersonalFeedbackSchema, PersonalProactivitySettingsSchema, type PersonalFeedback,
  PersonalStrategyRollbackSchema, type PersonalProactivitySettings, type PersonalProvenanceDetail } from '@xopcai/gateway-contract';

import { DurableState } from '../../storage/sqlite/durable-state.js';
import { createContextEvidence } from '../../storage/sqlite/context-evidence-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getPersonalAgentByConversation } from '../repository.js';
import { getUserProfileSnapshot } from '../../user-model/profile.js';
import { isExplicitFollowUp, requestedCheckTime } from './follow-up-request.js';

export interface AttentionThread {
  id: string; owner_id: string; agent_id: string; conversation_id: string;
  subject: string; summary: string; kind: 'outcome' | 'discussion' | 'interest';
  status: 'candidate' | 'active' | 'paused' | 'completed' | 'expired';
  authority: 'user_explicit' | 'inferred'; task_id: string | null; project_id: string | null;
  next_check_at: number | null; pause_until: number | null; expires_at: number;
  last_meaningful_at: number; revision: number; created_at: number; updated_at: number;
}
export interface AttentionSource {
  entryId: string; transcriptId: string; conversationId: string; excerpt: string;
  processingPolicy: string | null; version: string;
}
export interface Wakeup {
  id: string; thread_id: string; trigger_kind: string; source_event_id: string | null;
  thread_revision: number; lease_token: string | null; attempts: number; expires_at: number;
}
export interface Outreach {
  id: string; wakeup_id: string; thread_id: string; conversation_id: string; origin_transcript_id: string;
  thread_revision: number; context_revision: number; policy_revision: number; decision: string;
  reason: string; state: string; text: string | null; provenance_json: string; valid_until: number;
  message_entry_id: string | null; notified_at: number | null; created_at: number; published_at: number | null;
}

export function getProactivitySettings(ownerId: string): PersonalProactivitySettings {
  const saved = new DurableState('personal-proactivity', ownerId).get('settings');
  const timezone = getUserProfileSnapshot().timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return PersonalProactivitySettingsSchema.parse(saved ?? { timezone });
}
export function patchProactivitySettings(ownerId: string, input: PersonalProactivitySettings): PersonalProactivitySettings {
  return runSqliteWriteTransaction(() => {
    const current = getProactivitySettings(ownerId);
    if (input.revision !== current.revision) throw new Error('Proactivity settings changed');
    const next = PersonalProactivitySettingsSchema.parse({ ...input, revision: current.revision + 1 });
    new DurableState('personal-proactivity', ownerId).set('settings', next);
    return next;
  });
}
export function localDay(now: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function isQuiet(now: number, settings: PersonalProactivitySettings): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const { quietStart: start, quietEnd: end } = settings;
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
export function reserveModelCall(ownerId: string, now: number): boolean {
  return runSqliteWriteTransaction(() => {
    const settings = getProactivitySettings(ownerId);
    const state = new DurableState<number>('personal-proactivity-budget', ownerId);
    const key = localDay(now, settings.timezone);
    const calls = state.get(key) ?? 0;
    if (calls >= settings.dailyModelCalls) return false;
    state.set(key, calls + 1);
    for (const [old] of state.entries()) if (old !== key) state.delete(old);
    return true;
  });
}
export function getAttention(id: string, ownerId?: string): AttentionThread | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM personal_attention_threads WHERE id = ?').get(id) as unknown as AttentionThread | undefined;
  return row && (!ownerId || row.owner_id === ownerId) ? row : undefined;
}
export function listAttention(conversationId: string): AttentionThread[] {
  return getSqliteDatabase().prepare('SELECT * FROM personal_attention_threads WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 30')
    .all(conversationId) as unknown as AttentionThread[];
}
export function getAttentionSources(threadId: string, entryIds?: string[]): AttentionSource[] {
  if (entryIds && (!entryIds.length || entryIds.length > 12)) return [];
  return (getSqliteDatabase().prepare(`SELECT s.entry_id, s.transcript_id, s.conversation_id, t.payload_json, e.processing_policy
    FROM personal_attention_sources s JOIN transcript_entries t ON t.entry_id = s.entry_id
    JOIN context_evidence e ON e.evidence_id = s.evidence_id
    JOIN sessions c ON c.conversation_id = s.conversation_id
    WHERE s.thread_id = ? AND c.active_transcript_id = s.transcript_id AND t.role = 'user'
      AND COALESCE(json_extract(t.payload_json, '$.metadata.hiddenFromClient'), 0) = 0
      ${entryIds ? `AND s.entry_id IN (${entryIds.map(() => '?').join(',')})` : ''} ORDER BY t.seq DESC LIMIT 12`)
    .all(threadId, ...(entryIds ?? [])) as Array<{ entry_id: string; transcript_id: string; conversation_id: string; payload_json: string; processing_policy: string | null }>).
    map(row => ({ entryId: row.entry_id, transcriptId: row.transcript_id, conversationId: row.conversation_id,
      excerpt: userText(JSON.parse(row.payload_json)).slice(0, 600), processingPolicy: row.processing_policy,
      version: createHash('sha256').update(row.payload_json).digest('hex') }));
}
export function userText(payload: { content?: unknown }): string {
  if (typeof payload.content === 'string') return payload.content;
  return Array.isArray(payload.content) ? payload.content.map(part => part?.type === 'text' ? part.text : '').join('\n') : '';
}
export function sourceFingerprint(sources: AttentionSource[]): string {
  return createHash('sha256').update(JSON.stringify(sources)).digest('hex');
}

/** Only user transcript rows can establish attention; inferred attention never grants work authorization. */
export function saveAttention(input: {
  conversationId: string; subject: string; summary: string; kind: AttentionThread['kind'];
  entryIds: string[]; explicit: boolean; nextCheckAt: number; taskId?: string; projectId?: string;
}, now = Date.now()): AttentionThread {
  return runSqliteWriteTransaction(db => {
    const personal = getPersonalAgentByConversation(input.conversationId);
    if (!personal || personal.state !== 'ready') throw new Error('Personal Agent is unavailable');
    const transcriptId = readCurrentTranscriptId(db, input.conversationId);
    const subject = input.subject.trim().slice(0, 160);
    if (!subject || !input.entryIds.length || input.entryIds.length > 12) throw new Error('Attention needs user evidence');
    const sources = [...new Set(input.entryIds)].map(id => {
      const row = db.prepare("SELECT payload_json, created_at FROM transcript_entries WHERE entry_id = ? AND transcript_id = ? AND role = 'user' AND COALESCE(json_extract(payload_json, '$.metadata.hiddenFromClient'), 0) = 0")
        .get(id, transcriptId) as { payload_json: string; created_at: number } | undefined;
      if (!row) throw new Error('Attention source is unavailable');
      const text = userText(JSON.parse(row.payload_json));
      if (!text.trim()) throw new Error('Attention source is empty');
      return { id, text, observedAt: row.created_at };
    });
    const explicitSource = sources.filter(source => isExplicitFollowUp(source.text)).sort((a, b) => b.observedAt - a.observedAt)[0];
    const explicit = input.explicit && Boolean(explicitSource);
    if (input.explicit && !explicit) throw new Error('Follow-up requires an explicit user request');
    if (!Number.isFinite(input.nextCheckAt)) throw new Error('Invalid attention time');
    const existing = db.prepare('SELECT * FROM personal_attention_threads WHERE conversation_id = ? AND subject = ? COLLATE NOCASE LIMIT 1')
      .get(input.conversationId, subject) as unknown as AttentionThread | undefined;
    // Automatic extraction cannot resurrect a topic explicitly ended by its owner.
    if (existing && ['completed', 'expired', 'paused'].includes(existing.status)) return existing;
    const id = existing?.id ?? randomUUID();
    const settings = getProactivitySettings(personal.ownerId);
    if (input.kind === 'interest' && existing?.authority === 'user_explicit') return existing;
    const kind = existing && !(existing.kind === 'interest' && explicit) ? existing.kind : input.kind;
    if (kind === 'interest' && (explicit || sources.some(source => isExplicitFollowUp(source.text)))) {
      throw new Error('Follow-up requests are not interest evidence');
    }
    const authority = existing?.authority === 'user_explicit' || explicit ? 'user_explicit' : 'inferred';
    const normalize = (text: string) => text.slice(0, 600).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const oldCount = existing ? getAttentionSources(id).map(source => normalize(source.excerpt)) : [];
    const count = new Set([...oldCount, ...sources.map(source => normalize(source.text))]).size;
    if (kind === 'interest') {
      const previous = existing ? interestSources(existing.id) : [];
      const evidence = interestSupport([...previous, ...sources.map(source => ({ entryId: source.id, excerpt: source.text, observedAt: source.observedAt }))], settings.timezone, now);
      if (evidence.independentStatements < 2 || evidence.independentDays < 2) throw new Error('Interest needs independent user evidence across days');
    }
    const status = kind === 'interest' ? 'candidate'
      : authority === 'user_explicit' || settings.mode === 'balanced' && count >= 2 ? 'active' : 'candidate';
    if (input.taskId && !db.prepare(`SELECT 1 FROM task_origin_links WHERE task_id = ? AND conversation_id = ?`).get(input.taskId, input.conversationId)) {
      throw new Error('Task is not linked to this conversation');
    }
    if (input.projectId && !db.prepare('SELECT 1 FROM sessions WHERE conversation_id = ? AND project_id = ?').get(input.conversationId, input.projectId)) {
      throw new Error('Project is not linked to this conversation');
    }
    const requestedAt = explicit && explicitSource
      ? requestedCheckTime(explicitSource.text, explicitSource.observedAt, settings.timezone) : undefined;
    const nextAt = Math.max(now + 60_000, Math.min(requestedAt ?? input.nextCheckAt, now + 30 * 86_400_000));
    const observedAt = Math.min(now, Math.max(...sources.map(source => source.observedAt), existing?.last_meaningful_at ?? 0));
    const expiresAt = observedAt + 30 * 86_400_000;
    if (existing) db.prepare(`UPDATE personal_attention_threads SET summary = ?, authority = ?, status = ?, kind = ?,
      task_id = COALESCE(?, task_id), project_id = COALESCE(?, project_id),
      next_check_at = ?, expires_at = ?, last_meaningful_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
      .run(input.summary.slice(0, 1600), authority, status, kind, input.taskId ?? null, input.projectId ?? null,
        kind === 'interest' ? null : Math.min(nextAt, expiresAt), expiresAt, observedAt, now, id);
    else db.prepare(`INSERT INTO personal_attention_threads
      (id, owner_id, agent_id, conversation_id, subject, summary, kind, status, authority, task_id, project_id,
      next_check_at, expires_at, last_meaningful_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, personal.ownerId, personal.agentId, input.conversationId, subject, input.summary.slice(0, 1600), kind,
        status, authority, input.taskId ?? null, input.projectId ?? null, kind === 'interest' ? null : Math.min(nextAt, expiresAt), expiresAt, observedAt, now, now);
    for (const source of sources) {
      const evidence = createContextEvidence({ sourceType: 'conversation', sourceRef: `personal-attention:${source.id}`,
        conversationId: input.conversationId, messageId: source.id, trustLevel: 'owner', observedAt: source.observedAt });
      db.prepare('INSERT OR IGNORE INTO personal_attention_sources(thread_id,evidence_id,entry_id,transcript_id,conversation_id) VALUES (?,?,?,?,?)')
        .run(id, evidence.id, source.id, transcriptId, input.conversationId);
    }
    return getAttention(id)!;
  });
}
export function patchAttention(ownerId: string, id: string, revision: number,
  patch: { status?: 'candidate' | 'active' | 'paused' | 'completed'; nextCheckAt?: number | null }, now = Date.now()): AttentionThread {
  return runSqliteWriteTransaction(db => {
    const current = getAttention(id, ownerId);
    if (!current) throw new Error('Attention is unavailable');
    if (current.revision !== revision) throw new Error('Attention changed');
    const status = patch.status ?? current.status;
    if (current.kind === 'interest' && current.authority === 'inferred' && ['active', 'paused'].includes(status)) {
      throw new Error('Interest discovery is silent; explicit follow-up is required');
    }
    db.prepare(`UPDATE personal_attention_threads SET status = ?, next_check_at = ?, pause_until = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
      .run(status, patch.nextCheckAt === undefined ? current.next_check_at : patch.nextCheckAt, status === 'paused' ? patch.nextCheckAt ?? null : null, now, id);
    db.prepare("UPDATE personal_wakeups SET status = 'cancelled' WHERE thread_id = ? AND status IN ('pending','evaluating')").run(id);
    db.prepare("UPDATE personal_outreach SET state = 'cancelled' WHERE thread_id = ? AND state = 'ready'").run(id);
    return getAttention(id)!;
  });
}
export function enqueueWakeup(thread: AttentionThread, kind: string, identity: string, now = Date.now()): void {
  getSqliteDatabase().prepare(`INSERT OR IGNORE INTO personal_wakeups
    (id,thread_id,dedupe_key,trigger_kind,source_event_id,thread_revision,not_before,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), thread.id, `${thread.id}:${identity}`, kind, kind === 'change' ? identity : null,
      thread.revision, now, Math.min(thread.expires_at, now + 86_400_000), now);
}
export function enqueueDue(now = Date.now()): void {
  runSqliteWriteTransaction(db => {
    db.prepare("UPDATE personal_attention_threads SET status = 'expired', revision = revision + 1 WHERE expires_at <= ? AND status IN ('candidate','active','paused')").run(now);
    db.prepare("UPDATE personal_attention_threads SET status = 'active', pause_until = NULL, revision = revision + 1 WHERE status = 'paused' AND pause_until <= ? AND expires_at > ?").run(now, now);
    // Renew an overdue check identity after offline time or a full-day resource pause.
    db.prepare(`UPDATE personal_attention_threads SET revision = revision + 1, next_check_at = ?
      WHERE status = 'active' AND next_check_at <= ? AND EXISTS
      (SELECT 1 FROM personal_wakeups w WHERE w.thread_id = personal_attention_threads.id
        AND w.thread_revision = personal_attention_threads.revision AND w.expires_at <= ?
        AND w.status IN ('pending','evaluating','cancelled','dead_letter'))`).run(now, now, now);
    const threads = db.prepare("SELECT * FROM personal_attention_threads WHERE status = 'active' AND next_check_at <= ? ORDER BY next_check_at LIMIT 30")
      .all(now) as unknown as AttentionThread[];
    for (const thread of threads) enqueueWakeup(thread, thread.authority === 'user_explicit' ? 'follow_up' : 'discussion',
      `due:${thread.revision}:${thread.next_check_at}`, now);
    db.prepare("UPDATE personal_wakeups SET status = 'cancelled' WHERE expires_at <= ? AND status IN ('pending','evaluating')").run(now);
  });
}
export function getOutreach(id: string, ownerId?: string): Outreach | undefined {
  const row = getSqliteDatabase().prepare(`SELECT o.* FROM personal_outreach o JOIN personal_attention_threads t ON t.id = o.thread_id
    WHERE o.id = ? AND (? IS NULL OR t.owner_id = ?)`).get(id, ownerId ?? null, ownerId ?? null) as unknown as Outreach | undefined;
  return row;
}
export function provenanceDetail(ownerId: string, id: string): PersonalProvenanceDetail | undefined {
  const outreach = getOutreach(id, ownerId);
  if (!outreach || outreach.state !== 'published') return undefined;
  const thread = getAttention(outreach.thread_id, ownerId)!;
  const snapshot = JSON.parse(outreach.provenance_json);
  const currentSources = getAttentionSources(thread.id, snapshot.sourceIds);
  const sources = sourceFingerprint(currentSources) === snapshot.fingerprint ? currentSources : [];
  return { provenance: snapshot.display,
    thread: { id: thread.id, subject: sources.length ? thread.subject : '', status: thread.status,
      revision: thread.revision, nextCheckAt: thread.next_check_at },
    whyNow: sources.length ? outreach.reason : '', sourcesAvailable: sources.length > 0,
    sources: sources.map(({ processingPolicy: _policy, version: _version, ...source }) => source),
    strategy: strategyState(thread.id) };
}
export function recordFeedback(ownerId: string, id: string, raw: PersonalFeedback, now = Date.now()): void {
  const input = PersonalFeedbackSchema.parse(raw);
  runSqliteWriteTransaction(db => {
    const outreach = getOutreach(id, ownerId);
    if (!outreach || outreach.state !== 'published') throw new Error('Message is unavailable');
    const previous = db.prepare('SELECT outreach_id, payload_json FROM personal_feedback WHERE owner_id = ? AND dedupe_key = ?')
      .get(ownerId, input.idempotencyKey) as { outreach_id: string; payload_json: string } | undefined;
    if (previous) {
      if (previous.outreach_id !== id || previous.payload_json !== JSON.stringify(input)) throw new Error('Feedback key was already used');
      return;
    }
    if (input.until && (input.until <= now || input.until > now + 30 * 86_400_000)) throw new Error('Invalid defer time');
    const feedbackId = randomUUID();
    db.prepare('INSERT INTO personal_feedback(id,outreach_id,thread_id,owner_id,kind,scope,payload_json,created_at,dedupe_key) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(feedbackId, id, outreach.thread_id, ownerId, input.kind, input.scope, JSON.stringify(input), now, input.idempotencyKey);
    const thread = getAttention(outreach.thread_id, ownerId)!;
    if (['stop', 'defer', 'adjust'].includes(input.kind) && input.scope === 'thread') {
      applyThreadFeedback(ownerId, thread.id, thread.revision, input, { feedbackId }, now);
    }

  });
}

type InterestSource = { entryId: string; excerpt: string; observedAt: number };
function interestSources(threadId: string): InterestSource[] {
  return getAttentionSources(threadId).map(source => ({ entryId: source.entryId, excerpt: source.excerpt,
    observedAt: Number(getSqliteDatabase().prepare('SELECT created_at FROM transcript_entries WHERE entry_id = ?').get(source.entryId)!.created_at) }));
}
function interestSupport(sources: InterestSource[], timezone: string, now: number) {
  const independent = new Map<string, InterestSource>();
  for (const source of sources) {
    if (source.observedAt < now - 30 * 86_400_000 || source.observedAt > now) continue;
    const normalized = source.excerpt.replace(/^\[[^\]]+\]\s*/u, '').slice(0, 500).trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
    if (normalized && (!independent.has(normalized) || independent.get(normalized)!.observedAt < source.observedAt)) independent.set(normalized, source);
  }
  const independentStatements = independent.size;
  const independentDays = new Set([...independent.values()].map(source => localDay(source.observedAt, timezone))).size;
  return { independentStatements, independentDays,
    confidence: independentStatements === 0 ? 0 : Math.min(0.85, Math.round((0.25 + independentStatements * 0.08 + independentDays * 0.04) * 100) / 100) };
}
export function listInterestCandidates(conversationId: string, now = Date.now()) {
  const personal = getPersonalAgentByConversation(conversationId);
  if (!personal) return [];
  const timezone = getProactivitySettings(personal.ownerId).timezone;
  return listAttention(conversationId).filter(thread => thread.kind === 'interest').map(thread => {
    const sources = interestSources(thread.id);
    return { id: thread.id, subject: thread.subject, summary: thread.summary,
      status: thread.expires_at <= now && thread.status === 'candidate' ? 'expired' : thread.status,
      ...interestSupport(sources, timezone, now), lastSupportedAt: thread.last_meaningful_at, expiresAt: thread.expires_at,
      sources: sources.map(source => ({ ...source, excerpt: source.excerpt.slice(0, 600) })) };
  }).filter(candidate => candidate.sources.length > 0);
}

type StrategySnapshot = {
  status: AttentionThread['status']; nextCheckAt: number | null; pauseUntil: number | null;
  preparation: { value: 'brief' | 'thorough'; reviewAt: number } | null;
};
type StrategyVersion = { id: string; owner_id: string; thread_id: string; revision: number;
  kind: 'stop' | 'defer' | 'adjust' | 'rollback'; before_json: string; after_json: string; input_json: string; created_at: number };
function latestStrategy(threadId: string): StrategyVersion | undefined {
  return getSqliteDatabase().prepare('SELECT * FROM personal_strategy_versions WHERE thread_id = ? ORDER BY revision DESC LIMIT 1')
    .get(threadId) as unknown as StrategyVersion | undefined;
}
export function preparationStrategy(threadId: string, now = Date.now()): 'brief' | 'thorough' | null {
  const latest = latestStrategy(threadId);
  if (latest) {
    const preparation = (JSON.parse(latest.after_json) as StrategySnapshot).preparation;
    return preparation && preparation.reviewAt > now ? preparation.value : null;
  }
  const legacy = getSqliteDatabase().prepare('SELECT value FROM personal_adaptive_strategies WHERE thread_id = ? AND review_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(threadId, now);
  return legacy?.value as 'brief' | 'thorough' | undefined ?? null;
}
export function strategyState(threadId: string, now = Date.now()) {
  const versions = getSqliteDatabase().prepare('SELECT * FROM personal_strategy_versions WHERE thread_id = ? ORDER BY revision DESC LIMIT 5')
    .all(threadId) as unknown as StrategyVersion[];
  return { preparation: preparationStrategy(threadId, now), versions: versions.map(version => ({
    id: version.id, revision: version.revision, kind: version.kind, createdAt: version.created_at,
    preparation: (JSON.parse(version.after_json) as StrategySnapshot).preparation?.value ?? null,
  })) };
}
function strategySnapshot(thread: AttentionThread, now: number): StrategySnapshot {
  const latest = latestStrategy(thread.id);
  const legacy = getSqliteDatabase().prepare('SELECT value,review_at FROM personal_adaptive_strategies WHERE thread_id = ? AND review_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(thread.id, now);
  const preparation = latest ? (JSON.parse(latest.after_json) as StrategySnapshot).preparation
    : legacy ? { value: legacy.value as 'brief' | 'thorough', reviewAt: Number(legacy.review_at) } : null;
  return { status: thread.status, nextCheckAt: thread.next_check_at, pauseUntil: thread.pause_until,
    preparation: preparation && preparation.reviewAt > now ? preparation : null };
}
function existingStrategyOperation(ownerId: string, key: string, input: string): StrategyVersion | undefined {
  const existing = getSqliteDatabase().prepare('SELECT * FROM personal_strategy_versions WHERE owner_id = ? AND dedupe_key = ?')
    .get(ownerId, key) as unknown as StrategyVersion | undefined;
  if (existing && existing.input_json !== input) throw new Error('Strategy key was already used');
  return existing;
}
export function applyThreadFeedback(ownerId: string, threadId: string, revision: number, raw: PersonalFeedback,
  source: { feedbackId?: string; entryId?: string } = {}, now = Date.now()): AttentionThread {
  const input = PersonalFeedbackSchema.parse(raw);
  if (input.scope !== 'thread' || !['stop', 'defer', 'adjust'].includes(input.kind)) throw new Error('A lasting strategy requires explicit thread feedback');
  return runSqliteWriteTransaction(db => {
    const operation = JSON.stringify({ threadId, input });
    const key = `feedback:${input.idempotencyKey}`;
    if (existingStrategyOperation(ownerId, key, operation)) return getAttention(threadId, ownerId)!;
    const thread = getAttention(threadId, ownerId);
    if (!thread || thread.revision !== revision) throw new Error('Attention changed');
    if (input.kind !== 'stop' && ['completed', 'expired'].includes(thread.status)) throw new Error('Attention has ended');
    if (input.until && (input.until <= now || input.until > now + 30 * 86_400_000)) throw new Error('Invalid defer time');
    const before = strategySnapshot(thread, now);
    const next = patchAttention(ownerId, threadId, revision, input.kind === 'stop' ? { status: 'completed' }
      : input.kind === 'defer' ? { status: 'paused', nextCheckAt: input.until } : {}, now);
    const after = strategySnapshot(next, now);
    if (input.kind === 'adjust') {
      after.preparation = { value: input.preparation!, reviewAt: now + 30 * 86_400_000 };
      if (source.feedbackId) db.prepare('INSERT INTO personal_adaptive_strategies(id,thread_id,feedback_id,dimension,value,authority,revision,created_at,review_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), threadId, source.feedbackId, 'preparation', input.preparation!, 'explicit', next.revision, now, after.preparation.reviewAt);
    }
    db.prepare(`INSERT INTO personal_strategy_versions(id,owner_id,thread_id,revision,kind,before_json,after_json,input_json,source_entry_id,feedback_id,dedupe_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), ownerId, threadId, next.revision, input.kind,
      JSON.stringify(before), JSON.stringify(after), operation, source.entryId ?? null, source.feedbackId ?? null, key, now);
    return next;
  });
}
export function rollbackStrategy(ownerId: string, threadId: string,
  raw: { versionId: string; revision: number; idempotencyKey: string }, sourceEntryId?: string, now = Date.now()): AttentionThread {
  const input = PersonalStrategyRollbackSchema.parse(raw);
  return runSqliteWriteTransaction(db => {
    const operation = JSON.stringify({ threadId, input });
    const key = `rollback:${input.idempotencyKey}`;
    if (existingStrategyOperation(ownerId, key, operation)) return getAttention(threadId, ownerId)!;
    const thread = getAttention(threadId, ownerId);
    const version = latestStrategy(threadId);
    if (!thread || thread.revision !== input.revision || !version || version.id !== input.versionId) throw new Error('Strategy changed; reload before undoing');
    const before = strategySnapshot(thread, now);
    const previous = JSON.parse(version.before_json) as StrategySnapshot;
    const applied = JSON.parse(version.after_json) as StrategySnapshot;
    const schedulingChanged = previous.status !== applied.status || previous.nextCheckAt !== applied.nextCheckAt || previous.pauseUntil !== applied.pauseUntil;
    if (schedulingChanged && (before.status !== applied.status || before.nextCheckAt !== applied.nextCheckAt || before.pauseUntil !== applied.pauseUntil)) {
      throw new Error('Strategy changed; newer scheduling must be preserved');
    }
    const restored = { ...(schedulingChanged ? previous : before), preparation: previous.preparation };
    if (thread.expires_at <= now || !getAttentionSources(threadId).length) throw new Error('Attention sources have expired');
    const next = patchAttention(ownerId, threadId, thread.revision, schedulingChanged ? {
      status: restored.status === 'paused' && restored.pauseUntil !== null && restored.pauseUntil <= now ? 'active' : restored.status as 'candidate' | 'active' | 'paused' | 'completed',
      nextCheckAt: restored.nextCheckAt === null ? null : Math.max(now + 60_000, restored.nextCheckAt),
    } : {}, now);
    db.prepare(`INSERT INTO personal_strategy_versions(id,owner_id,thread_id,revision,kind,before_json,after_json,input_json,source_entry_id,restored_version_id,dedupe_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), ownerId, threadId, next.revision, 'rollback', JSON.stringify(before),
      JSON.stringify({ ...restored, status: next.status, nextCheckAt: next.next_check_at, pauseUntil: next.pause_until }),
      operation, sourceEntryId ?? null, version.id, key, now);
    return next;
  });
}
