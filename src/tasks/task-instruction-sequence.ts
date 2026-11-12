import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export function taskInstructionSequence(taskId: string): number {
  return (getSqliteDatabase().prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence
    FROM task_collaboration_entries WHERE task_id = ? AND author_kind IN ('main_agent', 'user')
      AND kind IN ('answer', 'instruction')`).get(taskId) as { sequence: number }).sequence;
}
