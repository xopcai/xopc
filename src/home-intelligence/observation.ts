import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { HomeEvidence, HomeOpportunity, ObservationCommandRequest, ObservationState } from '@xopcai/gateway-contract';

import { stripRuntimeContextFromUserMessage } from '../session/user-message-display.js';
import { runSqliteSavepoint } from '../storage/sqlite/transaction.js';
import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';
import { OWNER_LEARNING_SESSION_SQL } from '../memory-learning/transcript-source.js';
import type { HomePrincipal } from './repository.js';

type SessionRow = { id: string; status: 'active' | 'paused'; revision: number; start_at: number; last_processed_at: number | null; analyzed_revision: number };
type TopicRow = { id: string; title: string; project_id: string | null; revision: number; source_key: string; excluded: number };
type SourceRow = { conversation_id: string; transcript_id: string; seq: number; payload_json: string; role: string; entry_id: string; created_at: number; name: string | null; project_id: string | null };

export class ObservationConflictError extends Error {}

function cleanWorkText(text: string): string {
  const clean = stripRuntimeContextFromUserMessage(text).trim();
  return /<\/?(?:source_contexts?|user_message|xopc_task_execution)\b/i.test(clean) ? '' : clean.slice(0, 1000);
}

function textContent(payload: string): string {
  try {
    const value = JSON.parse(payload);
    const content = value?.content;
    return cleanWorkText(typeof content === 'string' ? content : Array.isArray(content)
      ? content.filter((part: { type?: string }) => part.type === 'text').map((part: { text?: string }) => part.text ?? '').join('\n') : '');
  } catch { return ''; }
}

/** Durable observation state; model work is leased and budgeted by HomeIntelligenceHost. */
export class HomeObservation {
  constructor(private readonly db: DatabaseSync, private readonly principal: HomePrincipal,
    private readonly canRead: (conversationId: string) => boolean) {}

  private readable(id: string): boolean {
    try { return this.canRead(id); } catch { return false; }
  }

  private session(): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM home_observation_sessions WHERE owner_id=? AND workspace_id=?')
      .get(this.principal.ownerId, this.principal.workspaceId) as SessionRow | undefined;
  }

  private topic(id: string): TopicRow {
    const row = this.db.prepare(`SELECT t.* FROM home_observation_topics t JOIN home_observation_sessions s ON s.id=t.session_id
      WHERE t.id=? AND s.owner_id=? AND s.workspace_id=? AND t.excluded=0`)
      .get(id, this.principal.ownerId, this.principal.workspaceId) as TopicRow | undefined;
    if (!row) throw new ObservationConflictError('Observation topic is unavailable');
    return row;
  }

  private bump(sessionId: string, now: number): void {
    this.db.prepare('UPDATE home_observation_sessions SET revision=revision+1,last_processed_at=? WHERE id=?').run(now, sessionId);
  }

  private entry(topicId: string, sourceKey: string, kind: string, text: string, now: number, sourceRef?: string): boolean {
    return Boolean(this.db.prepare(`INSERT OR IGNORE INTO home_observation_entries
      (id,topic_id,source_key,kind,text,source_ref,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), topicId, sourceKey, kind, text.slice(0, 1000), sourceRef ?? null, now).changes);
  }

  command(input: ObservationCommandRequest, now = Date.now()): ObservationState {
    return runSqliteSavepoint(this.db, () => {
      let session = this.session();
      const request = createHash('sha256').update(JSON.stringify(input.command)).digest('hex');
      if (session) {
        const previous = this.db.prepare('SELECT request_json FROM home_observation_operations WHERE session_id=? AND operation_id=?')
          .get(session.id, input.idempotencyKey) as { request_json: string } | undefined;
        if (previous) {
          if (previous.request_json !== request) throw new ObservationConflictError('Operation key already used');
          return this.state();
        }
      }
      if ((session?.revision ?? 0) !== input.expectedRevision) throw new ObservationConflictError('Observation revision changed');
      const command = input.command;
      if (command.kind === 'start') {
        if (session) throw new ObservationConflictError('Observation already started');
        this.db.prepare(`INSERT INTO home_observation_sessions(id,owner_id,workspace_id,status,start_at) VALUES (?,?,?,'active',?)`)
          .run(randomUUID(), this.principal.ownerId, this.principal.workspaceId, now - command.backfillDays * 86400000);
        session = this.session()!;
      } else {
        if (!session) throw new ObservationConflictError('Observation has not started');
        if (command.kind === 'pause') this.db.prepare("UPDATE home_observation_sessions SET status='paused' WHERE id=?").run(session.id);
        else if (command.kind === 'resume') {
          if (session.status !== 'paused') throw new ObservationConflictError('Observation is not paused');
          this.db.prepare("UPDATE home_observation_sessions SET status='active' WHERE id=?").run(session.id);
          if (command.mode === 'new_only') {
            this.db.prepare('UPDATE home_observation_sessions SET start_at=? WHERE id=?').run(now, session.id);
            this.db.prepare(`INSERT INTO home_observation_cursors(session_id,source_id,through_seq)
              SELECT ?, transcript_id, MAX(seq) FROM transcript_entries GROUP BY transcript_id
              ON CONFLICT(session_id,source_id) DO UPDATE SET through_seq=MAX(through_seq,excluded.through_seq)`).run(session.id);
          }
        } else {
          const topic = this.topic(command.topicId);
          if (command.kind === 'feedback' && !this.readable(topic.source_key)) throw new ObservationConflictError('Topic source is no longer readable');
          if (command.kind === 'feedback') {
            if (session.status !== 'active') throw new ObservationConflictError('Resume observation before adding feedback');
            if (command.scope === 'project' && !topic.project_id) throw new ObservationConflictError('This topic has no project');
            if (['secret', 'regulated'].includes(inferMemorySensitivity(command.text))) throw new ObservationConflictError('Sensitive feedback cannot be stored in observation memory');
            const id = randomUUID();
            this.db.prepare(`INSERT INTO home_observation_feedback VALUES (?,?,?,?,'active',?)`)
              .run(id, topic.id, command.text, command.scope, now);
            this.entry(topic.id, `feedback:${id}`, 'feedback', command.text, now);
          } else if (command.kind === 'retract') {
            if (!this.db.prepare("UPDATE home_observation_feedback SET status='retracted' WHERE id=? AND topic_id=? AND status='active'")
              .run(command.feedbackId, topic.id).changes) throw new ObservationConflictError('Feedback unavailable');
            this.db.prepare('DELETE FROM home_observation_entries WHERE topic_id=? AND source_key=?').run(topic.id, `feedback:${command.feedbackId}`);
            this.db.prepare("DELETE FROM home_observation_entries WHERE topic_id=? AND kind='interpretation'").run(topic.id);
            this.db.prepare(`DELETE FROM home_advice_generations WHERE generation_id IN
              (SELECT generation_id FROM home_observation_analysis_sources WHERE topic_id=?)`).run(topic.id);
            this.db.prepare("UPDATE home_observation_trials SET feedback_json='[]' WHERE topic_id=?").run(topic.id);
            this.entry(topic.id, `retract:${command.feedbackId}`, 'retraction', 'Feedback retracted; dependent suggestions require review.', now);
          } else {
            this.db.prepare(`DELETE FROM home_advice_generations WHERE generation_id IN
              (SELECT generation_id FROM home_observation_analysis_sources WHERE topic_id=?)`).run(topic.id);
            this.db.prepare("UPDATE home_observation_topics SET excluded=1,title='',project_id=NULL WHERE id=?").run(topic.id);
            this.db.prepare(`DELETE FROM transcript_entries WHERE role='custom'
              AND json_extract(payload_json,'$.customType')='home_observation_context'
              AND json_extract(payload_json,'$.details.topicId')=?`).run(topic.id);
            this.db.prepare('DELETE FROM home_observation_entries WHERE topic_id=?').run(topic.id);
            this.db.prepare('DELETE FROM home_observation_feedback WHERE topic_id=?').run(topic.id);
            // Erase stored feedback copies while retaining the independently authorized task.
            this.db.prepare("UPDATE home_observation_trials SET feedback_json='[]' WHERE topic_id=?").run(topic.id);
          }
          this.db.prepare('UPDATE home_observation_topics SET revision=revision+1 WHERE id=?').run(topic.id);
        }
      }
      this.bump(session.id, now);
      // Operation receipts contain no private feedback text after forgetting a topic.
      this.db.prepare(`INSERT INTO home_observation_operations VALUES (?,?,?,?)`)
        .run(session.id, input.idempotencyKey, request, '{}');
      return this.state();
    });
  }

  /** Notifications are hints: authoritative transcript rows provide crash recovery. */
  collect(now = Date.now()): boolean {
    const session = this.session();
    if (!session || session.status !== 'active') return false;
    return runSqliteSavepoint(this.db, () => {
      let changed = false;
      const sources = this.db.prepare(`SELECT tr.transcript_id,s.conversation_id,s.name,s.project_id FROM transcripts tr
        JOIN sessions s ON s.conversation_id=tr.conversation_id
        WHERE s.source_channel!='automation' AND s.parent_conversation_id IS NULL AND ${OWNER_LEARNING_SESSION_SQL}
        AND COALESCE((SELECT user_context_mode FROM session_config WHERE conversation_id=s.conversation_id),'enabled')='enabled'
        AND EXISTS (
          SELECT 1 FROM transcript_entries e WHERE e.transcript_id=tr.transcript_id AND e.created_at>=?
          AND e.seq>COALESCE((SELECT through_seq FROM home_observation_cursors c WHERE c.session_id=? AND c.source_id=tr.transcript_id),0))
        ORDER BY COALESCE((SELECT through_seq FROM home_observation_cursors c WHERE c.session_id=? AND c.source_id=tr.transcript_id),0),tr.created_at LIMIT 100`)
        .all(session.start_at, session.id, session.id) as Array<{ transcript_id: string; conversation_id: string; name: string | null; project_id: string | null }>;
      for (const source of sources) {
        if (!this.readable(source.conversation_id)) continue;
        const rows = this.db.prepare(`SELECT e.* FROM transcript_entries e WHERE e.transcript_id=? AND e.created_at>=?
          AND e.seq>COALESCE((SELECT through_seq FROM home_observation_cursors WHERE session_id=? AND source_id=?),0)
          ORDER BY e.seq LIMIT 40`).all(source.transcript_id, session.start_at, session.id, source.transcript_id) as unknown as SourceRow[];
        if (!rows.length) continue;
        const sourceKey = source.conversation_id;
        let topic = this.db.prepare('SELECT * FROM home_observation_topics WHERE session_id=? AND (source_key=? OR discussion_conversation_id=?)').get(session.id, sourceKey, sourceKey) as TopicRow | undefined;
        for (const row of rows) {
          // Assistant/tool output does not establish user demand. Trial outcomes enter via receipts.
          if (row.role !== 'user') continue;
          const text = textContent(row.payload_json);
          if (!text || ['secret', 'regulated'].includes(inferMemorySensitivity(text))) continue;
          if (!topic) {
            const id = randomUUID();
            this.db.prepare('INSERT INTO home_observation_topics(id,session_id,source_key,title,project_id) VALUES (?,?,?,?,?)')
              .run(id, session.id, sourceKey, (source.name || 'Conversation').slice(0, 160), source.project_id);
            topic = this.topic(id);
          }
          if (topic.excluded) continue;
          changed = this.entry(topic.id, row.entry_id, 'user_work', text, row.created_at, source.conversation_id) || changed;
        }
        this.db.prepare(`INSERT INTO home_observation_cursors VALUES (?,?,?) ON CONFLICT(session_id,source_id)
          DO UPDATE SET through_seq=MAX(through_seq,excluded.through_seq)`).run(session.id, source.transcript_id, rows.at(-1)!.seq);
      }
      const receipts = this.db.prepare(`SELECT r.*,s.conversation_id,s.name,s.project_id FROM task_run_receipts r
        JOIN task_runs run ON run.run_id=r.run_id JOIN task_origin_links l ON l.task_id=run.task_id
        JOIN sessions s ON s.conversation_id=l.conversation_id
        WHERE r.finalized_at>=? AND ${OWNER_LEARNING_SESSION_SQL}
        AND COALESCE((SELECT user_context_mode FROM session_config WHERE conversation_id=s.conversation_id),'enabled')='enabled'
        AND NOT EXISTS (SELECT 1 FROM home_observation_cursors c WHERE c.session_id=? AND c.source_id='receipt:'||r.run_id)
        AND NOT EXISTS (SELECT 1 FROM home_observation_trials ot WHERE ot.task_id=run.task_id)
        AND NOT EXISTS (SELECT 1 FROM home_observation_topics ot WHERE ot.session_id=? AND ot.source_key=s.conversation_id AND ot.excluded=1)
        AND NOT EXISTS (
          SELECT 1 FROM home_observation_entries e JOIN home_observation_topics t ON t.id=e.topic_id
          WHERE t.session_id=? AND e.source_key='receipt:'||r.run_id)
        ORDER BY r.finalized_at LIMIT 100`).all(session.start_at, session.id, session.id, session.id) as Array<{
          conversation_id: string; name: string | null; project_id: string | null; run_id: string;
          status: string; summary: string; completion_verdict: string | null; finalized_at: number;
        }>;
      for (const receipt of receipts) {
        if (!this.readable(receipt.conversation_id)) continue;
        this.db.prepare('INSERT OR IGNORE INTO home_observation_cursors VALUES (?,?,1)').run(session.id, `receipt:${receipt.run_id}`);
        let topic = this.db.prepare('SELECT * FROM home_observation_topics WHERE session_id=? AND source_key=?').get(session.id, receipt.conversation_id) as TopicRow | undefined;
        if (!topic) {
          const id = randomUUID();
          this.db.prepare('INSERT INTO home_observation_topics(id,session_id,source_key,title,project_id) VALUES (?,?,?,?,?)')
            .run(id, session.id, receipt.conversation_id, (receipt.name || 'Task results').slice(0, 160), receipt.project_id);
          topic = this.topic(id);
        }
        if (!topic.excluded && !['secret','regulated'].includes(inferMemorySensitivity(receipt.summary))) changed = this.entry(topic.id,
          `receipt:${receipt.run_id}`, 'execution_result', JSON.stringify({ status: receipt.status, verdict: receipt.completion_verdict,
            summary: receipt.summary.slice(0, 600) }), receipt.finalized_at, receipt.conversation_id) || changed;
      }
      const trials = this.db.prepare(`SELECT l.id,l.topic_id,r.* FROM home_observation_trials l
        JOIN home_observation_topics t ON t.id=l.topic_id JOIN task_runs run ON run.task_id=l.task_id
        JOIN task_run_receipts r ON r.run_id=run.run_id WHERE t.session_id=? AND t.excluded=0 ORDER BY r.finalized_at DESC LIMIT 100`)
        .all(session.id) as Array<{ id: string; topic_id: string; run_id: string; status: string; summary: string; verification_json: string; completion_verdict: string | null; finalized_at: number }>;
      for (const trial of trials) {
        if (!this.readable(this.topic(trial.topic_id).source_key) || ['secret','regulated'].includes(inferMemorySensitivity(trial.summary))) continue;
        changed = this.entry(trial.topic_id, `receipt:${trial.run_id}`, 'trial_result',
          JSON.stringify({ status: trial.status, verdict: trial.completion_verdict, summary: trial.summary.slice(0, 400), verification: trial.verification_json.slice(0, 350) }), trial.finalized_at) || changed;
      }
      if (changed) this.bump(session.id, now);
      return changed;
    });
  }

  state(): ObservationState {
    const session = this.session();
    if (!session) return { status: 'disabled', revision: 0, analyzedRevision: 0, lastProcessedAt: null, topics: [] };
    const topics = this.db.prepare('SELECT * FROM home_observation_topics WHERE session_id=? AND excluded=0 ORDER BY rowid DESC LIMIT 20')
      .all(session.id) as TopicRow[];
      return { id: session.id, status: session.status, revision: session.revision, analyzedRevision: session.analyzed_revision,
      lastProcessedAt: session.last_processed_at, topics: topics.filter(t => this.readable(t.source_key)).map(t => ({
        id: t.id, title: t.title, projectId: t.project_id ?? undefined, revision: t.revision,
        entries: (this.db.prepare('SELECT id,kind,text,source_ref AS sourceRef,created_at AS createdAt FROM home_observation_entries WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20').all(t.id) as ObservationState['topics'][number]['entries'])
          .filter(e => !e.sourceRef || this.readable(e.sourceRef)).map(e => {
            if (e.kind !== 'user_work') return e;
            const original = this.db.prepare(`SELECT payload_json FROM transcript_entries WHERE entry_id=(SELECT source_key FROM home_observation_entries WHERE id=?)`).get(e.id) as {payload_json:string}|undefined;
            return {...e,text:original ? textContent(original.payload_json) : cleanWorkText(e.text)};
          }).filter(e => e.text && !/<\/?(?:source_contexts?|xopc_task_execution)\b/i.test(e.text)).reverse(),
        feedback: this.db.prepare('SELECT id,text,scope,status,created_at AS createdAt FROM home_observation_feedback WHERE topic_id=? ORDER BY created_at DESC LIMIT 40').all(t.id) as ObservationState['topics'][number]['feedback'],
        trials: this.db.prepare(`SELECT t.task_id AS taskId,t.title,t.phase,t.resolution,t.version AS taskVersion FROM home_observation_trials l
          JOIN tasks t ON t.task_id=l.task_id WHERE l.topic_id=? ORDER BY l.created_at DESC LIMIT 10`).all(t.id) as ObservationState['topics'][number]['trials'],
      })) };
  }

  context(now: number): { revision: number; evidence: HomeEvidence[]; feedback: Array<{ topicId: string; text: string; scope: string; projectId?: string }>; understanding: Array<{ topicId: string; summary: string; projectId?: string }> } {
    const state = this.state();
    if (state.status !== 'active') return { revision: state.revision, evidence: [], feedback: [], understanding: [] };
    return { revision: state.revision,
      evidence: state.topics.flatMap(topic => topic.entries.filter(e => ['user_work','execution_result','trial_result'].includes(e.kind)).slice(-4).map(e => ({
        id: `observation:${topic.id}:${e.id}`, sourceType: 'conversation' as const,
        sourceRef: e.sourceRef ?? this.topic(topic.id).source_key, revision: e.id, observation: `[${e.kind}] ${e.text}`.slice(0,1000),
        observedAt: e.createdAt, freshUntil: now + 12 * 3600000, href: `/chat/${encodeURIComponent(e.sourceRef ?? this.topic(topic.id).source_key)}`,
      }))).slice(-40),
      feedback: state.topics.flatMap(t => t.feedback.filter(f => f.status === 'active' && f.scope !== 'once')
        .map(f => ({ topicId: t.id, text: f.text, scope: f.scope, projectId: t.projectId }))).slice(-40),
      understanding: state.topics.flatMap(t => {
        const summary = t.entries.findLast(e => e.kind === 'interpretation');
        return summary ? [{ topicId: t.id, summary: summary.text, projectId: t.projectId }] : [];
      }).slice(-10),
    };
  }

  analyzed(revision: number): void {
    const session = this.session();
    if (session?.status === 'active' && session.revision === revision) this.db.prepare('UPDATE home_observation_sessions SET analyzed_revision=? WHERE id=?').run(revision, session.id);
  }

  recordAnalysis(generationId: string, opportunities: HomeOpportunity[], now: number): void {
    for (const topic of this.state().topics) {
      this.db.prepare('INSERT OR IGNORE INTO home_observation_analysis_sources VALUES (?,?)').run(generationId, topic.id);
      const related = opportunities.find(o => this.topicFor(o) === topic.id);
      if (related) this.entry(topic.id, `analysis:${generationId}`, 'interpretation', related.rationale, now);
    }
  }

  topicFor(opportunity: HomeOpportunity): string | undefined {
    for (const evidence of opportunity.evidence) {
      const match = /^observation:([^:]+):/.exec(evidence.id);
      if (match) {
        const topic = this.topic(match[1]!);
        if (!this.readable(topic.source_key)) throw new ObservationConflictError('Topic source is no longer readable');
        return match[1];
      }
    }
    return undefined;
  }

  trialFeedback(topicId: string): string[] {
    const state = this.state();
    const topic = state.topics.find(t => t.id === topicId);
    if (!topic) throw new ObservationConflictError('Topic source is no longer readable');
    const last = this.db.prepare('SELECT MAX(created_at) AS at FROM home_observation_trials WHERE topic_id=?').get(topicId) as { at: number | null };
    return state.topics.flatMap(t => t.feedback.filter(f => f.status === 'active'
      && (t.id === topicId || (f.scope === 'project' && topic.projectId && t.projectId === topic.projectId))
      && (f.scope !== 'once' || last.at === null || f.createdAt > last.at))).map(f => `[${f.scope}] ${f.text}`);
  }

  recordTrial(topicId: string, opportunityId: string, taskId: string, now: number): void {
    const topic = this.topic(topicId);
    this.db.prepare('INSERT OR IGNORE INTO home_observation_trials VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), topicId, opportunityId, taskId, JSON.stringify(this.trialFeedback(topicId)), now);
    this.db.prepare(`INSERT OR IGNORE INTO task_origin_links(task_id,conversation_id,created_at,origin_transcript_id)
      SELECT ?,conversation_id,?,active_transcript_id FROM sessions WHERE conversation_id=?`).run(taskId, now, topic.source_key);
    this.entry(topicId, `trial:${opportunityId}`, 'trial_started', 'A trial task was created; its result is not yet verified.', now);
  }
}
