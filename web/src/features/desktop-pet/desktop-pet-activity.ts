import { resolveToolActivity, type ToolActivity } from '@xopcai/gateway-contract';

import type { DesktopPetActivity, DesktopPetActivityPhase } from '@/types/electron';

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

export function activityPhaseForTool(
  toolName: string | undefined,
  activity?: ToolActivity,
): DesktopPetActivityPhase {
  const semantic = activity ?? resolveToolActivity(toolName ?? '', 'running');
  if (semantic.category === 'planning') return 'planning';
  if (semantic.category === 'navigation' || semantic.category === 'web' && semantic.action === 'read') return 'browsing';
  if (semantic.action === 'search') return 'researching';
  if (semantic.category === 'file' && (semantic.action === 'read' || semantic.action === 'list')) return 'reading';
  if (semantic.category === 'file' && (semantic.action === 'edit' || semantic.action === 'write')) return 'editing';
  if (semantic.category === 'command') return 'running';
  return 'preparing';
}

/** Derives only display-safe context; never expose commands, queries, or arbitrary tool arguments. */
export function activityForTool(
  toolName: string | undefined,
  args: unknown,
  semantic?: ToolActivity,
): DesktopPetActivity {
  const record = asRecord(args);
  const toolActivity = semantic ?? resolveToolActivity(toolName ?? '', 'running');
  const activity: DesktopPetActivity = { phase: activityPhaseForTool(toolName, toolActivity) };

  if (activity.phase === 'reading' || activity.phase === 'editing') {
    activity.detail = fileName(stringValue(record, 'path', 'filePath', 'file'));
  } else if (activity.phase === 'browsing') {
    activity.detail = origin(stringValue(record, 'url', 'href'));
  }

  // `exec_command` and search-style tools deliberately keep detail empty: their args may be sensitive.
  if (toolActivity.category === 'command' || toolActivity.action === 'search') {
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
