import { z } from 'zod';
import type { BrowserRecordingEvent } from '@xopcai/browser-control-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/index.js';
import type { BrowserAutomationService, BrowserAutomationDefinition, BrowserAutomationStep } from '../automations/index.js';

const Target = z.object({ role: z.string().min(1), name: z.string().max(240).optional(), nameIncludes: z.string().max(240).optional(),
  testId: z.string().max(240).optional(), scope: z.object({ role: z.string(), name: z.string().max(240) }).strict().optional() }).strict();
const Event = z.object({ id: z.string().uuid(), seq: z.number().int().positive(), documentId: z.string().max(200), sourceSeq: z.number().int().positive(),
  url: z.string().url().max(4096), action: z.enum(['navigate', 'click', 'fill', 'select', 'check', 'press', 'checkpoint', 'unsupported']), target: Target.optional(),
  value: z.string().max(4096).optional(), checked: z.boolean().optional(), key: z.enum(['Enter', 'Escape']).optional() }).strict();
const Batch = z.array(Event).min(1).max(100);
type RecordingRow = { recording_id: string; principal_id: string; state: string; ack_seq: number; final_seq: number | null; automation_id: string | null; error: string | null };

export class BrowserRecordingService {
  constructor(private readonly automations: BrowserAutomationService) {}

  get(id: string, principalId: string): RecordingRow | null {
    return getSqliteDatabase().prepare('SELECT * FROM browser_recordings WHERE recording_id=? AND principal_id=?').get(id, principalId) as RecordingRow ?? null;
  }

  append(id: string, principalId: string, payload: unknown) {
    z.string().uuid().parse(id);
    const events = Batch.parse(payload);
    return runSqliteWriteTransaction((db) => {
      const now = Date.now();
      db.prepare("INSERT OR IGNORE INTO browser_recordings (recording_id, principal_id, state, created_at_ms, updated_at_ms) VALUES (?, ?, 'recording', ?, ?)").run(id, principalId, now, now);
      const row = this.get(id, principalId);
      if (!row) throw new Error('Recording belongs to another device.');
      if (Math.max(row.ack_seq, events.at(-1)!.seq) > 10_000) throw new Error('Recording event budget exceeded.');
      let bytes = (db.prepare('SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) AS bytes FROM browser_recording_events WHERE recording_id=?').get(id) as { bytes: number }).bytes;
      for (const event of events) {
        const prior = db.prepare('SELECT payload_json FROM browser_recording_events WHERE recording_id=? AND seq=?').get(id, event.seq) as { payload_json: string } | undefined;
        const serialized = JSON.stringify(event);
        if (prior) { if (prior.payload_json !== serialized) throw new Error('Recording event conflict.'); continue; }
        bytes += Buffer.byteLength(serialized);
        if (bytes > 20 * 1024 * 1024) throw new Error('Recording storage budget exceeded.');
        if (row.state === 'saved') throw new Error('Recording is already finished.');
        if (event.seq !== this.get(id, principalId)!.ack_seq + 1) throw new Error('Recording event sequence has a gap.');
        if (!['http:', 'https:'].includes(new URL(event.url).protocol)) throw new Error('Only HTTP pages can be recorded.');
        db.prepare('INSERT INTO browser_recording_events (recording_id, seq, event_id, payload_json) VALUES (?, ?, ?, ?)').run(id, event.seq, event.id, serialized);
        db.prepare('UPDATE browser_recordings SET ack_seq=?, updated_at_ms=? WHERE recording_id=?').run(event.seq, now, id);
      }
      return { ackThrough: this.get(id, principalId)!.ack_seq };
    });
  }

  finish(id: string, principalId: string, finalSeq: number) {
    z.number().int().min(1).max(10_000).parse(finalSeq);
    const row = this.get(id, principalId);
    if (!row) throw new Error('Recording not found.');
    if (row.state === 'saved') {
      if (row.final_seq !== finalSeq) throw new Error('Recording final sequence conflicts with the saved recording.');
      return this.automations.get(row.automation_id!);
    }
    if (row.ack_seq !== finalSeq) throw new Error('Recording is incomplete. Waiting for all events.');
    const events = (getSqliteDatabase().prepare('SELECT payload_json FROM browser_recording_events WHERE recording_id=? ORDER BY seq').all(id) as { payload_json: string }[])
      .map((item) => JSON.parse(item.payload_json) as BrowserRecordingEvent);
    const sources = new Map<string, number>();
    for (const event of events) {
      if (event.sourceSeq !== (sources.get(event.documentId) ?? 0) + 1) throw new Error('Recording is incomplete: document events are missing.');
      sources.set(event.documentId, event.sourceSeq);
    }
    for (const documentId of sources.keys()) {
      if (events.filter((event) => event.documentId === documentId).at(-1)?.action !== 'checkpoint') throw new Error('Recording is incomplete: a document did not confirm its final events.');
    }
    const definition = compileRecording(id, events);
    return runSqliteWriteTransaction((db) => {
      const automation = this.automations.save({ definition });
      db.prepare("UPDATE browser_recordings SET state='saved', final_seq=?, automation_id=?, updated_at_ms=? WHERE recording_id=?").run(finalSeq, automation.id, Date.now(), id);
      return automation;
    });
  }
}

export function compileRecording(id: string, events: BrowserRecordingEvent[]): BrowserAutomationDefinition {
  const steps: BrowserAutomationStep[] = [];
  const inputs: BrowserAutomationDefinition['inputs'] = {};
  for (const event of events) {
    if (event.action === 'checkpoint') continue;
    if (event.action === 'unsupported') throw new Error(event.value || 'Recording contains an unsupported action.');
    if (event.action === 'navigate') {
      if (steps.length && ['click', 'press'].includes(steps.at(-1)!.action)) {
        steps.push({ action: 'wait', condition: 'page_idle' });
      } else if (!steps.length || steps.at(-1)?.action !== 'wait') steps.push({ action: 'navigate', url: event.url });
      continue;
    }
    if (!event.target) throw new Error('Recording contains an unsupported target.');
    if (event.action === 'fill' || event.action === 'select') {
      const key = `value${Object.keys(inputs).length + 1}`;
      inputs[key] = { type: 'string', default: event.value ?? '', description: event.target.name || key };
      steps.push({ action: event.action, target: event.target, value: `\${input.${key}}` });
    } else if (event.action === 'check') {
      if (event.checked === undefined) throw new Error('Recording checkbox state is missing.');
      steps.push({ action: 'check', target: event.target, checked: event.checked });
    } else if (event.action === 'press') {
      if (!event.key) throw new Error('Recording key is missing.');
      steps.push({ action: 'press', target: event.target, key: event.key });
    } else steps.push({ action: 'click', target: event.target });
  }
  if (!steps.length || steps.length > 100) throw new Error('Recording must contain between 1 and 100 executable steps.');
  const first = events[0]!;
  return { id: `recording-${id}`, name: events.find((event) => event.target?.name)?.target?.name || new URL(first.url).hostname,
    description: 'Recorded browser workflow', allowedDomains: [...new Set(events.map((event) => new URL(event.url).hostname))],
    risk: steps.some((step) => ['click', 'press'].includes(step.action)) ? 'external_effect' : 'draft', inputs, steps,
    outputs: { url: { field: 'url' } } };
}
