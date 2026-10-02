import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export interface TaskMainAgentLink {
  taskId: string;
  agentId: string;
  originConversationId?: string;
  createdAt: number;
}

export class TaskMainAgentRepository {
  get(taskId: string): TaskMainAgentLink | undefined {
    const row = getSqliteDatabase().prepare(`SELECT task_id AS taskId, agent_id AS agentId,
      origin_conversation_id AS originConversationId, created_at AS createdAt
      FROM task_main_agent_links WHERE task_id = ?`).get(taskId) as
      | { taskId: string; agentId: string; originConversationId: string | null; createdAt: number }
      | undefined;
    if (!row) return undefined;
    return { taskId: row.taskId, agentId: row.agentId, createdAt: row.createdAt,
      ...(row.originConversationId ? { originConversationId: row.originConversationId } : {}) };
  }

  list(agentId: string, limit = 50): TaskMainAgentLink[] {
    const rows = getSqliteDatabase().prepare(`SELECT task_id AS taskId, agent_id AS agentId,
      origin_conversation_id AS originConversationId, created_at AS createdAt
      FROM task_main_agent_links WHERE agent_id = ?
      ORDER BY created_at DESC, task_id DESC LIMIT ?`)
      .all(agentId, Math.max(1, Math.min(100, Math.floor(limit)))) as Array<{
        taskId: string; agentId: string; originConversationId: string | null; createdAt: number;
      }>;
    return rows.map((row) => ({ taskId: row.taskId, agentId: row.agentId, createdAt: row.createdAt,
      ...(row.originConversationId ? { originConversationId: row.originConversationId } : {}) }));
  }
}
