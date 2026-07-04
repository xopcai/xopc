import type { SessionTimelineItem } from '@/features/chat/session/session-manager';

export type ChatTimelineLabels = {
  title: string;
  turn: string;
  messageFallback: string;
  toolCount_one: string;
  toolCount_other: string;
  searchedWeb: string;
  readFile: string;
  runCommand: string;
  listDirectory: string;
  writeFile: string;
  editFile: string;
  openUrl: string;
  fetchUrl: string;
  unknownTool: string;
};

export type TimelineToolSummary = {
  key: string;
  label: string;
  running: boolean;
};

export type TimelineEventSummary = {
  key: string;
  label: string;
  tone: 'context' | 'branch' | 'compaction';
};

export type TimelineTurn = {
  id: string;
  messageIndex: number;
  ordinal: number;
  title: string;
  preview: string;
  timestamp?: number;
  tools: TimelineToolSummary[];
  events: TimelineEventSummary[];
};

function compactText(text: string | undefined, max: number): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function toolLabel(name: string, labels: ChatTimelineLabels): string {
  const normalized = name.toLowerCase().replace(/[-.]/g, '_');
  if (normalized.includes('search')) return labels.searchedWeb;
  if (normalized.includes('read')) return labels.readFile;
  if (normalized.includes('bash') || normalized.includes('shell') || normalized.includes('command')) {
    return labels.runCommand;
  }
  if (normalized === 'ls' || normalized.includes('list')) return labels.listDirectory;
  if (normalized.includes('write') || normalized.includes('save')) return labels.writeFile;
  if (normalized.includes('edit') || normalized.includes('patch')) return labels.editFile;
  if (normalized.includes('open')) return labels.openUrl;
  if (normalized.includes('fetch')) return labels.fetchUrl;
  return labels.unknownTool.replace('{{name}}', name);
}

function outlineEventTone(kind: SessionTimelineItem['kind']): TimelineEventSummary['tone'] | null {
  if (kind === 'context' || kind === 'branch' || kind === 'compaction') return kind;
  return null;
}

function outlineEventLabel(item: SessionTimelineItem): string {
  return compactText(item.preview || item.title, 72) || item.kind;
}

export function buildTimeline(
  items: readonly SessionTimelineItem[],
  labels: ChatTimelineLabels,
): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  let current: TimelineTurn | null = null;
  let lastDisplayIndex = 0;

  for (const item of items) {
    if (item.displayIndex !== undefined) {
      lastDisplayIndex = item.displayIndex;
    }
    if (item.kind === 'turn' && item.role === 'user') {
      const ordinal = item.turn || turns.length + 1;
      current = {
        id: item.id,
        messageIndex: item.displayIndex ?? lastDisplayIndex,
        ordinal,
        title: labels.turn.replace('{{count}}', String(ordinal)),
        preview: compactText(item.preview || item.title || labels.messageFallback, 88),
        ...(item.timestamp !== undefined ? { timestamp: item.timestamp } : {}),
        tools: [],
        events: [],
      };
      turns.push(current);
      continue;
    }

    if (!current) continue;

    if (item.kind === 'tool' || item.kind === 'file' || item.kind === 'command') {
      const name = item.meta?.toolName || item.title || item.kind;
      const label = item.kind === 'file' || item.kind === 'command' ? item.title : toolLabel(name, labels);
      const key = `${item.id}:${name}`;
      if (!current.tools.some((existing) => existing.key === key)) {
        current.tools.push({
          key,
          label,
          running: item.status === 'running',
        });
      }
      continue;
    }

    const tone = outlineEventTone(item.kind);
    if (!tone) continue;
    const key = `${item.id}:${item.kind}`;
    if (!current.events.some((existing) => existing.key === key)) {
      current.events.push({
        key,
        label: outlineEventLabel(item),
        tone,
      });
    }
  }

  return turns;
}

export function formatToolCount(count: number, labels: ChatTimelineLabels): string {
  const template = count === 1 ? labels.toolCount_one : labels.toolCount_other;
  return template.replace('{{count}}', String(count));
}
