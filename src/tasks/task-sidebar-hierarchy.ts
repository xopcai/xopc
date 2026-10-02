import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export interface SidebarTaskChild {
  taskId: string;
  title: string;
  phase: string;
  runStatus?: string;
  activeConversationId?: string;
}

export interface SidebarTaskGroup {
  total: number;
  activeCount: number;
  items: SidebarTaskChild[];
}

type SidebarTaskRow = {
  parent_id: string;
  task_id: string;
  title: string;
  conversation_title: string | null;
  phase: string;
  run_status: string | null;
  active_conversation_id: string | null;
};

/** Fetch task children for a page of conversations without one query per parent. */
export function listSidebarTaskGroups(conversationIds: readonly string[]): Record<string, SidebarTaskGroup> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const groups: Record<string, SidebarTaskGroup> = {};
  for (const id of ids) groups[id] = { total: 0, activeCount: 0, items: [] };
  const db = getSqliteDatabase();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const rows = db.prepare(`SELECT origin.conversation_id AS parent_id, task.task_id, task.title, task.phase,
      state.active_conversation_id,
      worker_session.name AS conversation_title,
      (SELECT run.status FROM task_runs run WHERE run.task_id = task.task_id
        AND run.parent_run_id IS NULL ORDER BY run.queued_at DESC LIMIT 1) AS run_status
      FROM task_origin_links origin
      JOIN tasks task ON task.task_id = origin.task_id
      LEFT JOIN task_conversation_state state ON state.task_id = task.task_id
      LEFT JOIN sessions worker_session ON worker_session.conversation_id = state.active_conversation_id
      WHERE origin.conversation_id IN (${batch.map(() => '?').join(', ')})
      ORDER BY CASE WHEN task.phase = 'closed' THEN 1 ELSE 0 END,
        task.updated_at DESC, task.task_id DESC`).all(...batch) as SidebarTaskRow[];
    for (const row of rows) {
      const group = groups[row.parent_id];
      group.total++;
      if (row.run_status ? ['queued', 'running', 'waiting', 'verifying'].includes(row.run_status)
        : row.phase === 'active') group.activeCount++;
      group.items.push({ taskId: row.task_id, title: row.conversation_title?.trim() || row.title, phase: row.phase,
        ...(row.run_status ? { runStatus: row.run_status } : {}),
        ...(row.active_conversation_id ? { activeConversationId: row.active_conversation_id } : {}) });
    }
  }
  return groups;
}
