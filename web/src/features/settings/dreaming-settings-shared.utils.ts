export function isoShort(v: string | null | undefined): string {
  if (!v) return '—';
  return v.replace('T', ' ').replace('Z', '');
}

export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
