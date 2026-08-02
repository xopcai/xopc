import {
  inferInteractionState,
  type InteractionStateSignal,
  type RelationshipRepairStatus,
  type SupportNeed,
} from '../../user-context/interaction-state.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const STATE_TTL_MS = 6 * 60 * 60 * 1_000;

export interface InteractionState extends InteractionStateSignal {
  sessionKey: string;
  expiresAt: number;
  updatedAt: number;
}

type Row = {
  session_key: string;
  support_need: SupportNeed;
  emotion_hypothesis: string | null;
  confidence: number;
  source: 'explicit' | 'inferred';
  repair_status: RelationshipRepairStatus;
  repair_reason: string | null;
  expires_at: number;
  updated_at: number;
};

function fromRow(row: Row): InteractionState {
  return {
    sessionKey: row.session_key,
    supportNeed: row.support_need,
    ...(row.emotion_hypothesis ? { emotionHypothesis: row.emotion_hypothesis } : {}),
    confidence: row.confidence,
    source: row.source,
    repairStatus: row.repair_status,
    ...(row.repair_reason ? { repairReason: row.repair_reason } : {}),
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

export function getInteractionState(sessionKey: string, now = Date.now()): InteractionState | undefined {
  const row = getSqliteDatabase().prepare(
    `SELECT session_key, support_need, emotion_hypothesis, confidence, source,
            repair_status, repair_reason, expires_at, updated_at
     FROM interaction_states WHERE session_key = ? AND expires_at > ?`,
  ).get(sessionKey, now) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function setInteractionState(input: {
  sessionKey: string;
  signal: InteractionStateSignal;
  now?: number;
}): InteractionState {
  const now = input.now ?? Date.now();
  const expiresAt = now + STATE_TTL_MS;
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO interaction_states (
        session_key, support_need, emotion_hypothesis, confidence, source,
        repair_status, repair_reason, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        support_need = excluded.support_need,
        emotion_hypothesis = excluded.emotion_hypothesis,
        confidence = excluded.confidence,
        source = excluded.source,
        repair_status = excluded.repair_status,
        repair_reason = excluded.repair_reason,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`,
    ).run(
      input.sessionKey,
      input.signal.supportNeed,
      input.signal.emotionHypothesis ?? null,
      input.signal.confidence,
      input.signal.source,
      input.signal.repairStatus,
      input.signal.repairReason ?? null,
      expiresAt,
      now,
    );
  });
  return getInteractionState(input.sessionKey, now)!;
}

export function updateInteractionStateFromMessage(input: {
  sessionKey: string;
  message: string;
  now?: number;
}): InteractionState {
  const now = input.now ?? Date.now();
  const previous = getInteractionState(input.sessionKey, now);
  const inferred = inferInteractionState(input.message);
  const signal = previous?.repairStatus === 'needed' && inferred.repairStatus === 'none'
    ? { ...inferred, repairStatus: 'needed' as const, repairReason: previous.repairReason }
    : inferred;
  return setInteractionState({ sessionKey: input.sessionKey, signal, now });
}
