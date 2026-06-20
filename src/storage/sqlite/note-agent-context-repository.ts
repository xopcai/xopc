import { requireXopcDatabase } from './connection.js';

export interface NoteAgentContextRecord<T = unknown> {
  noteId: string;
  noteUpdatedAt: number;
  contextVersion: string;
  generatedAt: number;
  payload: T;
}

export function getNoteAgentContextRecord<T = unknown>(noteId: string): NoteAgentContextRecord<T> | null {
  const db = requireXopcDatabase().db;
  const row = db.prepare(`
    SELECT note_id, note_updated_at, context_version, generated_at, payload_json
    FROM note_agent_contexts
    WHERE note_id = ?
  `).get(noteId) as { note_id: string; note_updated_at: number; context_version: string; generated_at: number; payload_json: string } | undefined;
  if (!row) return null;
  return {
    noteId: row.note_id,
    noteUpdatedAt: row.note_updated_at,
    contextVersion: row.context_version,
    generatedAt: row.generated_at,
    payload: JSON.parse(row.payload_json) as T,
  };
}

export function upsertNoteAgentContextRecord(record: NoteAgentContextRecord): void {
  const db = requireXopcDatabase().db;
  db.prepare(`
    INSERT INTO note_agent_contexts (note_id, note_updated_at, context_version, generated_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(note_id) DO UPDATE SET
      note_updated_at = excluded.note_updated_at,
      context_version = excluded.context_version,
      generated_at = excluded.generated_at,
      payload_json = excluded.payload_json
  `).run(
    record.noteId,
    record.noteUpdatedAt,
    record.contextVersion,
    record.generatedAt,
    JSON.stringify(record.payload),
  );
}

export function deleteNoteAgentContextRecord(noteId: string): void {
  const db = requireXopcDatabase().db;
  db.prepare(`DELETE FROM note_agent_contexts WHERE note_id = ?`).run(noteId);
}
