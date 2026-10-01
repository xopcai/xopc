import { XopcChatBlock, XopcChatRow, XopcLiveActivityTool, XopcStreamPayload } from '../model/chat';
import { chatToolDisplayKind } from './chatRichContent';

/** Keep only bounded, user-readable activity metadata from the realtime stream. */
export function reduceChatLiveActivity(row: XopcChatRow, event: string, payload: XopcStreamPayload): void {
  if (event === 'tool_start' && payload.toolCallId) {
    const tools = row.activityTools || [];
    const existing = tools.find((item: XopcLiveActivityTool): boolean => item.id === payload.toolCallId);
    if (!existing) {
      tools.push({ id: payload.toolCallId, kind: chatToolDisplayKind(payload.toolName || ''), status: 'running' });
      row.activityTools = tools.slice(-100);
    }
    if (!existing || existing.status === 'running') row.activity = tools.find((item: XopcLiveActivityTool): boolean =>
      item.id === payload.toolCallId)?.kind || 'working';
  } else if (event === 'tool_end' && payload.toolCallId) {
    const tools = row.activityTools || [];
    const match = tools.find((item: XopcLiveActivityTool): boolean => item.id === payload.toolCallId);
    if (match) match.status = payload.status === 'error' ? 'failed' : 'completed';
    const running = tools.find((item: XopcLiveActivityTool): boolean => item.status === 'running');
    row.activity = running?.kind || 'thinking';
  } else if (event === 'thinking_delta') {
    if (!(row.activityTools || []).some((item: XopcLiveActivityTool): boolean => item.status === 'running')) row.activity = 'thinking';
  } else if (event === 'assistant_delta' && payload.delta) {
    if (!(row.activityTools || []).some((item: XopcLiveActivityTool): boolean => item.status === 'running')) row.activity = 'responding';
  } else if (event === 'progress') {
    const stage = (payload.stage || '').toLowerCase();
    row.activity = ['thinking', 'search', 'read', 'command', 'write', 'edit', 'fetch', 'responding'].includes(stage)
      ? stage : 'working';
  } else if (event === 'run_end') {
    row.activity = '';
  } else return;
  row.activityUpdatedAtMs = Date.now();
}

/** Snapshot recovery keeps activity only; answer text remains authoritative in history. */
export function reduceChatSnapshotActivity(previous: XopcChatRow | undefined, event: string,
  payload: XopcStreamPayload, runId: string): XopcChatRow {
  const row: XopcChatRow = { id: 'live:' + runId, role: 'assistant', turnId: runId, text: '', live: true,
    executionActivity: true,
    activity: previous?.activity, activityUpdatedAtMs: previous?.activityUpdatedAtMs,
    activityTools: previous?.activityTools?.map((item: XopcLiveActivityTool): XopcLiveActivityTool => ({
      id: item.id, kind: item.kind, status: item.status })) };
  reduceChatLiveActivity(row, event, payload);
  return row;
}

export function chatLiveCompletedCount(row: XopcChatRow): number {
  return (row.activityTools || []).filter((item: XopcLiveActivityTool): boolean => item.status === 'completed').length;
}

export function chatLiveElapsedSeconds(startedAtMs: number, nowMs: number): number {
  return startedAtMs > 0 ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)) : 0;
}

/** Latest public narration for the fixed live status slot; never returns pending answer text or private thinking. */
export function chatLiveNarration(row: XopcChatRow): string {
  const blocks = row.blocks || [];
  if (blocks.some((block: XopcChatBlock): boolean =>
    block.kind === 'text' && block.presentation === 'pending' && !!block.text.trim())) return '';
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.kind === 'text' && block.presentation === 'narration' && block.text.trim()) {
      return block.text.replace(/\s+/g, ' ').trim().slice(0, 160);
    }
  }
  return '';
}
