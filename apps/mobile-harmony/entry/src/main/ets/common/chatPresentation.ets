import { XopcChatRow } from '../model/chat';
import { mergeAssistantRows, chatAnswerText } from './chatRichContent';

function copyPresentationRow(row: XopcChatRow): XopcChatRow {
  return { id: row.id, role: row.role, text: row.text, thinking: row.thinking, tools: row.tools,
    media: row.media?.slice(), refs: row.refs, toolCalls: row.toolCalls, blocks: row.blocks?.slice(),
    outcome: row.outcome, turnId: row.turnId, live: row.live, progress: row.progress, sourceIds: row.sourceIds?.slice(),
    toolResultId: row.toolResultId, toolResultError: row.toolResultError, toolResultDetails: row.toolResultDetails };
}

/** Keep the running state inside its response, without mutating retained history. */
export function chatPresentationRows(history: XopcChatRow[], live: XopcChatRow | undefined, runId: string): XopcChatRow[] {
  const rows = history.slice();
  const tail = rows[rows.length - 1];
  const sameTurn = !!tail?.turnId && tail.turnId === live?.turnId;
  const distinctTurn = !!tail?.turnId && !!live?.turnId && tail.turnId !== live.turnId;
  const unfinishedTail = tail?.role === 'assistant' && !tail.outcome && !chatAnswerText(tail);
  if (live) {
    if (tail?.role === 'assistant' && !distinctTurn && (sameTurn || unfinishedTail)) {
      const merged = mergeAssistantRows([copyPresentationRow(tail), copyPresentationRow(live)])[0];
      merged.live = live.live; merged.progress = live.progress;
      rows[rows.length - 1] = merged;
    } else rows.push(live);
  } else if (runId) {
    // Snapshot mode already contains the current answer, including partial final text.
    if (tail?.role === 'assistant' && (!tail.outcome || tail.outcome.runId === runId)) {
      const active = copyPresentationRow(tail); active.live = true;
      rows[rows.length - 1] = active;
    }
    else rows.push({ id: 'live:' + runId, role: 'assistant', text: '', live: true });
  }
  return rows;
}
