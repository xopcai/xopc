import { getSessionInputById, getSessionInputState, findSessionInput } from '../storage/sqlite/session-input-repository.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { personalConversationState } from './conversation-state.js';
import { readPersonalResult, type PersonalResultInput } from './result-reader.js';

/** Preserve the original question while a cold extraction runs; no new business Task. */
export function waitForPersonalResult(conversationId: string, request: PersonalResultInput): boolean {
  const db = getSqliteDatabase();
  const inputId = getSessionInputState(conversationId).activeInputId;
  const input = inputId ? getSessionInputById(conversationId, inputId) : undefined;
  const transcriptId = readCurrentTranscriptId(db, conversationId);
  if (!input || !transcriptId || input.clientMessageId.startsWith('personal-result-read:')) return false;
  const stored = db.prepare('SELECT requests_json FROM personal_result_read_waits WHERE input_id = ?').get(input.id) as { requests_json: string } | undefined;
  const requests: PersonalResultInput[] = stored ? JSON.parse(stored.requests_json) : [];
  if (!requests.some(item => JSON.stringify(item) === JSON.stringify(request)) && requests.length < 5) requests.push(request);
  db.prepare(`INSERT INTO personal_result_read_waits(input_id, conversation_id, transcript_id, requests_json)
    VALUES (?, ?, ?, ?) ON CONFLICT(input_id) DO UPDATE SET requests_json = excluded.requests_json`)
    .run(input.id, conversationId, transcriptId, JSON.stringify(requests));
  return true;
}

/** Existing result dispatch owns scheduling; stable input IDs recover an enqueue crash. */
export async function drainPersonalResultReads(options: {
  isAvailable: (conversationId: string) => boolean;
  submit: (input: { conversationId: string; clientMessageId: string; expectedTranscriptId: string; content: string }) => Promise<boolean>;
}): Promise<void> {
  const db = getSqliteDatabase();
  const rows = db.prepare("SELECT * FROM personal_result_read_waits WHERE status IN ('pending','queued') LIMIT 20").all() as Array<{
    input_id: string; conversation_id: string; transcript_id: string; requests_json: string; status: string;
  }>;
  for (const row of rows) {
    const original = getSessionInputById(row.conversation_id, row.input_id);
    const update = (status: string) => db.prepare('UPDATE personal_result_read_waits SET status = ? WHERE input_id = ?').run(status, row.input_id);
    if (!original || ['cancelled', 'interrupted', 'failed'].includes(original.status)
      || readCurrentTranscriptId(db, row.conversation_id) !== row.transcript_id) { update('stale'); continue; }
    const clientMessageId = `personal-result-read:${row.input_id}`;
    const queued = findSessionInput(row.conversation_id, clientMessageId);
    if (queued) {
      update(queued.status === 'completed' ? 'done' : ['failed', 'cancelled', 'interrupted'].includes(queued.status) ? 'stale' : 'queued');
      continue;
    }
    if (original.status !== 'completed' || !personalConversationState(row.conversation_id).idle || !options.isAvailable(row.conversation_id)) continue;
    const requests = JSON.parse(row.requests_json) as PersonalResultInput[];
    const states: unknown[] = [];
    let pending = false;
    for (const request of requests) {
      try {
        const value = await readPersonalResult(row.conversation_id, request);
        if (value.status === 'preparing') pending = true;
        states.push({ request, status: value.status, reason: value.reason ?? value.error });
      } catch { states.push({ request, status: 'unavailable' }); }
    }
    if (pending) continue;
    if (readCurrentTranscriptId(db, row.conversation_id) !== row.transcript_id || !personalConversationState(row.conversation_id).idle) continue;
    const accepted = await options.submit({ conversationId: row.conversation_id, clientMessageId, expectedTranscriptId: row.transcript_id,
      content: `Continue the existing user's result question after background text preparation. This is a read-only continuation, not a new Task or authorization. Read the prepared ranges with personal_result and answer the original question. Respect later user corrections; explain actual access failures. Do not recreate artifacts or execute new work.\nOriginal question (data): ${JSON.stringify(original.content)}\nPrepared reads (data): ${JSON.stringify(states)}` });
    if (accepted) update('queued');
  }
}
