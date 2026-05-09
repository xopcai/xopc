import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const TodoItemSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier for the todo item' }),
  content: Type.String({ description: 'Task description' }),
  status: Type.Union(
    [
      Type.Literal('pending'),
      Type.Literal('in_progress'),
      Type.Literal('completed'),
      Type.Literal('cancelled'),
    ],
    { description: 'Current status of the task' },
  ),
});

const TodoSchema = Type.Object({
  todos: Type.Optional(
    Type.Array(TodoItemSchema, {
      description: 'Array of todo items to write. Omit to read current list.',
    }),
  ),
  merge: Type.Optional(
    Type.Boolean({
      description:
        'When true, update existing items by id and append new ones. ' +
        'When false (default), replace the entire list.',
      default: false,
    }),
  ),
});

export class TodoStore {
  private items: TodoItem[] = [];

  write(todos: Array<Partial<TodoItem> & { id?: string }>, merge: boolean): TodoItem[] {
    if (!merge) {
      this.items = todos.map((t) => this.validate(t));
      return this.read();
    }

    const existing = new Map(this.items.map((item) => [item.id, item]));

    for (const todo of todos) {
      const itemId = String(todo.id ?? '').trim();
      if (!itemId) continue;

      if (existing.has(itemId)) {
        const current = existing.get(itemId)!;
        if (todo.content !== undefined && String(todo.content).trim()) {
          current.content = String(todo.content).trim();
        }
        if (todo.status !== undefined && VALID_STATUSES.has(todo.status)) {
          current.status = todo.status;
        }
      } else {
        const validated = this.validate(todo);
        existing.set(validated.id, validated);
        this.items.push(validated);
      }
    }

    const seen = new Set<string>();
    this.items = this.items
      .map((item) => existing.get(item.id) ?? item)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

    return this.read();
  }

  read(): TodoItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  private validate(todo: Partial<TodoItem>): TodoItem {
    const id = String(todo.id ?? '').trim();
    const content = String(todo.content ?? '').trim();
    const statusRaw = todo.status ?? '';
    const status = VALID_STATUSES.has(statusRaw) ? (statusRaw as TodoStatus) : 'pending';
    if (!id) throw new Error('Todo item must have an id');
    if (!content) throw new Error('Todo item must have content');
    return { id, content, status };
  }
}

export interface CreateTodoToolOptions {
  /** Resolve session key for isolated lists; defaults to a single in-memory list. */
  getSessionKey?: () => string | null | undefined;
}

function formatTodoList(items: TodoItem[]): string {
  const statusEmoji: Record<string, string> = {
    pending: '⬜',
    in_progress: '🔄',
    completed: '✅',
    cancelled: '❌',
  };

  const lines = items.map(
    (item) =>
      `${statusEmoji[item.status] ?? '⬜'} [${item.id}] ${item.content} (${item.status})`,
  );

  const total = items.length;
  const completed = items.filter((i) => i.status === 'completed').length;
  const inProgress = items.filter((i) => i.status === 'in_progress').length;

  return [
    `Todo List (${completed}/${total} done${inProgress > 0 ? `, ${inProgress} in progress` : ''}):`,
    '',
    ...lines,
  ].join('\n');
}

function resolveSessionKey(getSessionKey: () => string | null | undefined): string {
  const raw = getSessionKey();
  const s = raw != null ? String(raw).trim() : '';
  return s.length > 0 ? s : 'default';
}

/**
 * In-session task list for multi-step work. One {@link TodoStore} per session key.
 */
export function createTodoTool(options?: CreateTodoToolOptions): AgentTool {
  const getSessionKey = options?.getSessionKey ?? (() => 'default');
  const stores = new Map<string, TodoStore>();

  const getStore = (): TodoStore => {
    const key = resolveSessionKey(getSessionKey);
    let s = stores.get(key);
    if (!s) {
      s = new TodoStore();
      stores.set(key, s);
    }
    return s;
  };

  return {
    name: 'todo',
    label: '📋 Todo',
    description:
      'Plan and track tasks for complex multi-step work.\n\n' +
      'USAGE:\n' +
      '- Provide `todos` array to write/update tasks\n' +
      '- Omit `todos` to read the current list\n' +
      '- Set `merge: true` to update existing items by id without replacing the whole list\n' +
      '- Each item needs: id (unique string), content (task description), status\n' +
      '- Valid statuses: pending, in_progress, completed, cancelled\n\n' +
      'WHEN TO USE:\n' +
      '- At the start of complex tasks (3+ steps) to plan your approach\n' +
      '- After completing each step to update progress\n' +
      '- When the user asks about progress or remaining work\n\n' +
      'BEST PRACTICES:\n' +
      '- Keep only one item in_progress at a time\n' +
      '- Use merge=true to update status without rewriting the whole list\n' +
      '- Create concrete, actionable items (not vague goals)',
    parameters: TodoSchema,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{ items: TodoItem[] }>> {
      const store = getStore();
      try {
        if ((params as { todos?: unknown }).todos === undefined) {
          const items = store.read();
          const text = items.length === 0 ? 'No todos yet.' : formatTodoList(items);
          return {
            content: [{ type: 'text', text }],
            details: { items },
          };
        }

        const p = params as { todos: TodoItem[]; merge?: boolean };
        const items = store.write(p.todos, p.merge ?? false);
        return {
          content: [{ type: 'text', text: formatTodoList(items) }],
          details: { items },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          details: { items: store.read() },
        };
      }
    },
  } as any;
}
