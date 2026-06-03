export function fileExtColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) return 'text-green-600 dark:text-green-400';
  if (lower.endsWith('.json')) return 'text-yellow-600 dark:text-yellow-400';
  if (lower.endsWith('.ts') || lower.endsWith('.js')) return 'text-blue-600 dark:text-blue-400';
  return 'text-fg-muted';
}
