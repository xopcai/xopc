export type ToolActivityCategory =
  | 'memory'
  | 'web'
  | 'code'
  | 'file'
  | 'command'
  | 'navigation'
  | 'planning'
  | 'other';

export type ToolActivityAction =
  | 'search'
  | 'read'
  | 'list'
  | 'write'
  | 'edit'
  | 'execute'
  | 'open'
  | 'plan'
  | 'use';

export type ToolActivityStatus = 'running' | 'completed' | 'empty' | 'failed';
export type ToolActivitySource = 'memory' | 'internet' | 'workspace' | 'runtime' | 'unknown';

export type ToolActivity = {
  category: ToolActivityCategory;
  action: ToolActivityAction;
  status: ToolActivityStatus;
  source: ToolActivitySource;
  sensitivity: 'normal' | 'personal';
  purpose?: 'personal_context';
  count?: number;
};

type ToolActivityDefinition = Omit<ToolActivity, 'status' | 'count'>;

const OTHER_ACTIVITY: ToolActivityDefinition = {
  category: 'other',
  action: 'use',
  source: 'unknown',
  sensitivity: 'normal',
};

const TOOL_ACTIVITY_CATALOG: Readonly<Record<string, ToolActivityDefinition>> = {
  memory_search: {
    category: 'memory', action: 'search', source: 'memory', sensitivity: 'personal', purpose: 'personal_context',
  },
  memory_get: {
    category: 'memory', action: 'read', source: 'memory', sensitivity: 'personal', purpose: 'personal_context',
  },
  web_search: { category: 'web', action: 'search', source: 'internet', sensitivity: 'normal' },
  brave_search: { category: 'web', action: 'search', source: 'internet', sensitivity: 'normal' },
  image_query: { category: 'web', action: 'search', source: 'internet', sensitivity: 'normal' },
  web_fetch: { category: 'web', action: 'read', source: 'internet', sensitivity: 'normal' },
  fetch_url: { category: 'web', action: 'read', source: 'internet', sensitivity: 'normal' },
  open_url: { category: 'navigation', action: 'open', source: 'internet', sensitivity: 'normal' },
  browser_use: { category: 'navigation', action: 'open', source: 'internet', sensitivity: 'normal' },
  search_graph: { category: 'code', action: 'search', source: 'workspace', sensitivity: 'normal' },
  search_code: { category: 'code', action: 'search', source: 'workspace', sensitivity: 'normal' },
  query_graph: { category: 'code', action: 'search', source: 'workspace', sensitivity: 'normal' },
  trace_path: { category: 'code', action: 'search', source: 'workspace', sensitivity: 'normal' },
  get_architecture: { category: 'code', action: 'search', source: 'workspace', sensitivity: 'normal' },
  get_code_snippet: { category: 'file', action: 'read', source: 'workspace', sensitivity: 'normal' },
  grep: { category: 'code', action: 'search', source: 'workspace', sensitivity: 'normal' },
  glob: { category: 'code', action: 'search', source: 'workspace', sensitivity: 'normal' },
  find_files: { category: 'code', action: 'search', source: 'workspace', sensitivity: 'normal' },
  session_search: { category: 'other', action: 'search', source: 'runtime', sensitivity: 'normal' },
  search: { category: 'other', action: 'search', source: 'unknown', sensitivity: 'normal' },
  read_file: { category: 'file', action: 'read', source: 'workspace', sensitivity: 'normal' },
  'review.prepare_diff': { category: 'file', action: 'read', source: 'workspace', sensitivity: 'normal' },
  list_dir: { category: 'file', action: 'list', source: 'workspace', sensitivity: 'normal' },
  ls: { category: 'file', action: 'list', source: 'workspace', sensitivity: 'normal' },
  write_file: { category: 'file', action: 'write', source: 'workspace', sensitivity: 'normal' },
  apply_patch: { category: 'file', action: 'edit', source: 'workspace', sensitivity: 'normal' },
  exec_command: { category: 'command', action: 'execute', source: 'runtime', sensitivity: 'normal' },
  run_command: { category: 'command', action: 'execute', source: 'runtime', sensitivity: 'normal' },
  update_plan: { category: 'planning', action: 'plan', source: 'runtime', sensitivity: 'normal' },
};

export function toolActivityId(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/-/g, '_');
  const namespaced = normalized.split('__').at(-1) ?? normalized;
  return namespaced.split('.').at(-1) ?? namespaced;
}

function resolveToolActivityDefinition(name: string): ToolActivityDefinition {
  const normalized = name.trim().toLowerCase().replace(/-/g, '_');
  return TOOL_ACTIVITY_CATALOG[normalized] ?? TOOL_ACTIVITY_CATALOG[toolActivityId(normalized)] ?? OTHER_ACTIVITY;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resultCount(result: unknown): number | undefined {
  const record = asRecord(result);
  const details = asRecord(record?.details);
  const results = details?.results ?? record?.results;
  return Array.isArray(results) ? results.length : undefined;
}

function resultHasError(result: unknown): boolean {
  const record = asRecord(result);
  const details = asRecord(record?.details);
  return typeof (details?.error ?? record?.error) === 'string';
}

export function resolveToolActivity(
  name: string,
  status: ToolActivityStatus,
  result?: unknown,
): ToolActivity {
  const definition = resolveToolActivityDefinition(name);
  const count = resultCount(result);
  const resolvedStatus = status === 'completed' && resultHasError(result)
    ? 'failed'
    : status === 'completed' && count === 0
      ? 'empty'
      : status;
  return {
    ...definition,
    status: resolvedStatus,
    ...(count === undefined ? {} : { count }),
  };
}
