import type { DesktopPetActivity, DesktopPetActivityPhase } from '@/types/electron';

function normalizedToolName(toolName: string | undefined): string {
  return toolName?.trim().toLowerCase().replace(/[.:/\\]+/g, '_') ?? '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function fileName(value: string | undefined): string | undefined {
  if (!value || value.includes('\n') || value.includes('\r')) return undefined;
  const name = value.replace(/\\/g, '/').split('/').filter(Boolean).at(-1);
  if (!name || name.length > 80 || /(?:token|api[_-]?key|password|secret)=/i.test(name)) return undefined;
  return name;
}

function origin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : undefined;
  } catch {
    return undefined;
  }
}

export function activityPhaseForTool(toolName: string | undefined): DesktopPetActivityPhase {
  const name = normalizedToolName(toolName);
  if (name === 'update_plan' || name.includes('plan')) return 'planning';
  if (name.includes('browser') || name.includes('playwright') || name.includes('chrome')) return 'browsing';
  if (name.includes('search') || name.includes('image_query') || name.includes('web_fetch')) return 'researching';
  if (name.includes('read_file') || name.includes('file_read') || name.includes('list_dir')) return 'reading';
  if (name.includes('patch') || name.includes('edit_file') || name.includes('write_file')) return 'editing';
  if (name.includes('exec_command') || name.includes('run_command') || name.includes('shell')) return 'running';
  if (name.includes('open_url') || name.includes('fetch_url')) return 'browsing';
  return 'preparing';
}

/** Derives only display-safe context; never expose commands, queries, or arbitrary tool arguments. */
export function activityForTool(
  toolName: string | undefined,
  args: unknown,
): DesktopPetActivity {
  const name = normalizedToolName(toolName);
  const record = asRecord(args);
  const activity: DesktopPetActivity = { phase: activityPhaseForTool(toolName) };

  if (activity.phase === 'reading' || activity.phase === 'editing') {
    activity.detail = fileName(stringValue(record, 'path', 'filePath', 'file'));
  } else if (activity.phase === 'browsing') {
    activity.detail = origin(stringValue(record, 'url', 'href'));
  }

  // `exec_command` and search-style tools deliberately keep detail empty: their args may be sensitive.
  if (name.includes('exec_command') || name.includes('search') || name.includes('query')) {
    delete activity.detail;
  }
  return activity;
}

export function activityForProgress(payload: unknown): DesktopPetActivity {
  const record = asRecord(payload);
  const stage = stringValue(record, 'stage')?.toLowerCase();
  const phase: DesktopPetActivityPhase =
    stage === 'compaction'
      ? 'compacting'
      : stage === 'planning'
        ? 'planning'
        : stage === 'research' || stage === 'search'
          ? 'researching'
          : stage === 'verification' || stage === 'running'
            ? 'running'
            : stage === 'waiting' || stage === 'clarifying'
              ? 'waiting'
              : 'preparing';
  const completed = Number(record['completed']);
  const total = Number(record['total']);
  return {
    phase,
    ...(Number.isFinite(completed) && completed >= 0 ? { completed } : {}),
    ...(Number.isFinite(total) && total > 0 ? { total } : {}),
  };
}
