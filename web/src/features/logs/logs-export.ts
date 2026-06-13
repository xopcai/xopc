import type { LogEntry } from '@/features/logs/log.types';

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function logsToCsv(logs: readonly LogEntry[]): string {
  const header = ['timestamp', 'level', 'module', 'phase', 'requestId', 'sessionId', 'message'];
  const rows = logs.map((log) => {
    const module = String(log.module || '');
    const phase = String(log.phase ?? log.meta?.phase ?? '');
    return [
      log.timestamp,
      log.level,
      module,
      phase,
      log.requestId ?? '',
      log.sessionId ?? '',
      log.message ?? '',
    ]
      .map((cell) => escapeCsv(String(cell)))
      .join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadLogsExport(logs: readonly LogEntry[], format: 'json' | 'csv'): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (format === 'json') {
    downloadTextFile(JSON.stringify(logs, null, 2), `xopc-logs-${stamp}.json`, 'application/json');
    return;
  }
  downloadTextFile(logsToCsv(logs), `xopc-logs-${stamp}.csv`, 'text/csv;charset=utf-8');
}
