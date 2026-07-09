import type { SessionTimelineItem } from '../session/transcript-outline.js';

export interface TuiTimelineTurn {
  id: string;
  turn: number;
  displayIndex: number;
  rowNumber?: number;
  preview: string;
  timestamp?: number;
  toolCount: number;
  running: boolean;
}

function compactText(text: string, max = 72): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export function buildTuiTimelineTurns(items: readonly SessionTimelineItem[]): TuiTimelineTurn[] {
  const turns: TuiTimelineTurn[] = [];
  let current: TuiTimelineTurn | null = null;
  let currentToolKeys = new Set<string>();
  let lastDisplayIndex = 0;

  for (const item of items) {
    if (typeof item.displayIndex === 'number' && Number.isFinite(item.displayIndex)) {
      lastDisplayIndex = item.displayIndex;
    }

    if (item.kind === 'turn' && item.role === 'user') {
      const turn = item.turn || turns.length + 1;
      current = {
        id: item.id,
        turn,
        displayIndex: item.displayIndex ?? lastDisplayIndex,
        preview: compactText(item.preview || item.title || 'Message'),
        toolCount: 0,
        running: false,
        ...(item.rowNumber !== undefined ? { rowNumber: item.rowNumber } : {}),
        ...(item.timestamp !== undefined ? { timestamp: item.timestamp } : {}),
      };
      turns.push(current);
      currentToolKeys = new Set();
      continue;
    }

    if (!current) continue;

    if (item.kind === 'tool' || item.kind === 'file' || item.kind === 'command') {
      const key = `${item.id}:${item.meta?.toolName ?? item.title ?? item.kind}`;
      if (currentToolKeys.has(key)) {
        current.running ||= item.status === 'running';
        continue;
      }
      currentToolKeys.add(key);
      current.toolCount += 1;
      current.running ||= item.status === 'running';
    }
  }

  return turns;
}

export function findTimelineTurnByNumber(
  turns: readonly TuiTimelineTurn[],
  turnNumber: number,
): TuiTimelineTurn | undefined {
  return turns.find((turn) => turn.turn === turnNumber);
}

export function findNearestTimelineTurnByDisplayIndex(
  turns: readonly TuiTimelineTurn[],
  displayIndex: number,
): TuiTimelineTurn | undefined {
  let selected = turns[0];
  for (const turn of turns) {
    if (turn.displayIndex <= displayIndex) {
      selected = turn;
      continue;
    }
    break;
  }
  return selected;
}

export function formatTimelineToolSummary(toolCount: number): string {
  if (toolCount <= 0) return '0 tools';
  return `${toolCount} tool${toolCount === 1 ? '' : 's'}`;
}
