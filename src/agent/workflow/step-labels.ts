/**
 * Human-readable labels for workflow subagent tool steps (server-side snapshot).
 * Mirrors the web `tool-friendly-title` rules so IM/TUI and gateway stay aligned.
 */

const MAX_DETAIL_LEN = 120;

export function workflowStepLabel(
  toolName: string,
  args: Record<string, unknown>,
): { label: string; detail?: string } {
  const n = toolName.toLowerCase().replace(/-/g, '_').trim();
  let label = toolName.trim() || 'tool';
  if (n === 'shell') label = 'Run command';
  else if (n === 'list_dir' || n === 'ls') label = 'List directory';
  else if (n === 'write_file') label = 'Write file';
  else if (n === 'edit_file') label = 'Edit file';
  else if (n === 'web_fetch') label = 'Fetch URL';
  else if (n === 'open_url') label = 'Open URL';
  else if (n === 'web_search' || n === 'brave_search' || n.includes('search')) label = 'Search web';
  else if (n === 'read_file' || n.includes('read_file') || n.includes('file_read')) label = 'Read file';
  else if (n === 'grep' || n === 'rg') label = 'Search files';
  else if (n === 'delegate_task' || n === 'workflow') label = toolName;

  const detail = extractStepDetail(n, args);
  return detail ? { label, detail } : { label };
}

function extractStepDetail(toolKey: string, args: Record<string, unknown>): string | undefined {
  const pathKeys = ['path', 'file_path', 'filePath', 'target_file', 'targetFile'];
  for (const key of pathKeys) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return truncate(v.trim());
  }
  if (toolKey === 'shell' && typeof args.command === 'string' && args.command.trim()) {
    return truncate(args.command.trim());
  }
  if (
    (toolKey.includes('search') || toolKey === 'grep' || toolKey === 'rg') &&
    typeof args.query === 'string' &&
    args.query.trim()
  ) {
    return truncate(args.query.trim());
  }
  if (typeof args.url === 'string' && args.url.trim()) return truncate(args.url.trim());
  return undefined;
}

function truncate(text: string): string {
  if (text.length <= MAX_DETAIL_LEN) return text;
  return `${text.slice(0, MAX_DETAIL_LEN - 1)}…`;
}
