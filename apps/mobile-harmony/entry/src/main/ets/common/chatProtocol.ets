import type { XopcHistory, XopcChatRow, XopcContentBlock, XopcContextRef, XopcChatTool, XopcChatBlock, XopcHistoryMedia } from '../model/chat';
import { chatMedia, chatOutcome, chatReview, chatAttachments, chatHistoryAudio, refreshChatRow } from './chatRichContent';

function toolText(name: string, input?: Object, result?: Object): string {
  return name + (input !== undefined ? '\n' + JSON.stringify(input).slice(0, 6000) : '')
    + (result !== undefined ? '\n' + resultText(result).slice(0, 6000) : '') + '\n';
}

function resultText(result: Object): string { return typeof result === 'string' ? result : JSON.stringify(result); }

// Run again when older pages arrive so page-boundary tool results can join their calls.
export function mergeHistoryToolResults(rows: XopcChatRow[]): XopcChatRow[] {
  const output: XopcChatRow[] = [];
  for (const row of rows) {
    if (row.role !== 'tool' && row.role !== 'toolResult') { output.push(row); continue; }
    let owner: XopcChatRow | undefined; let target: XopcChatTool | undefined;
    for (let i = output.length - 1; i >= 0; i--) {
      const candidate = output[i];
      if (candidate.role === 'user') break;
      if (candidate.role !== 'assistant') continue;
      const calls = candidate.toolCalls ?? [];
      if (row.toolResultId) target = calls.find((call: XopcChatTool): boolean => call.id === row.toolResultId);
      else {
        const pending = calls.filter((call: XopcChatTool): boolean => call.result === undefined);
        if (pending.length === 1) target = pending[0];
      }
      if (target) { owner = candidate; break; }
      if (!row.toolResultId) break;
    }
    if (!owner || !target) { output.push(row); continue; }
    target.result = row.text; target.isError = row.toolResultError === true; target.status = target.isError ? 'error' : 'done';
    target.details = row.toolResultDetails ?? target.details;
    owner.tools = (owner.toolCalls ?? []).map((call: XopcChatTool): string => toolText(call.name, call.input, call.result)).join('').trim();
    const media = owner.media ?? [];
    owner.media = media.concat((row.media ?? []).filter((file): boolean => !media.some((old): boolean => old.id === file.id || old.uri === file.uri)));
  }
  return output;
}

export function historyRows(history: XopcHistory, page: string = 'latest'): XopcChatRow[] {
  if (!history.session || !Array.isArray(history.session.messages) || !history.pagination) throw new Error('INVALID_HISTORY');
  const rows: XopcChatRow[] = [];
  history.session.messages.forEach((message, index: number): void => {
    if (!['user', 'user-with-attachments', 'assistant', 'tool', 'toolResult'].includes(message.role)) return;
    const rowId = message.id ?? message.messageId ?? page + ':' + index;
    const blocks: XopcChatBlock[] = [];
    const inlineMedia: XopcHistoryMedia[] = [];
    let text: string = '';
    let thinking: string = ''; let tools: string = '';
    const calls: XopcChatTool[] = [];
    const addCall = (id: string, name: string, input?: Object, result?: Object, isError?: boolean, details?: Object): void => {
      const existing = id ? calls.find((call: XopcChatTool): boolean => call.id === id) : undefined;
      if (existing) {
        if (result !== undefined) { existing.result = resultText(result); existing.isError = isError; existing.status = isError ? 'error' : 'done'; }
        if (details !== undefined) existing.details = details;
        if (existing.input === undefined) existing.input = input;
      } else {
        const call: XopcChatTool = { id: id || rowId + ':anonymous:' + calls.length, name, input,
          result: result === undefined ? undefined : resultText(result), isError, details, status: isError ? 'error' : result !== undefined ? 'done' : 'pending' };
        calls.push(call); blocks.push({ id: 'tool:' + call.id, kind: 'tool', text: '', call });
      }
    };
    const toolIds: Set<string> = new Set<string>();
    const content = Array.isArray(message.rawContent) && message.rawContent.length ? message.rawContent : message.content;
    if (typeof content === 'string') { text = content; blocks.push({ id: rowId + ':text', kind: 'text', text }); }
    else if (Array.isArray(content)) text = content.map((block: XopcContentBlock, blockIndex: number): string => {
      if (!block || typeof block !== 'object') return '';
      const blockId = rowId + ':' + blockIndex;
      if (block.type === 'text') { blocks.push({ id: blockId, kind: 'text', text: block.text ?? '', segmentId: block.segmentId, presentation: block.presentation }); return block.text ?? ''; }
      if (block.type === 'thinking') { thinking += (block.thinking ?? block.text ?? '') + '\n';
        blocks.push({ id: blockId, kind: 'thinking', text: block.thinking ?? block.text ?? '', segmentId: block.segmentId, active: false }); return ''; }
      if (block.type === 'toolCall' || block.type === 'tool_use' || block.type === 'tool_call') {
        if (block.id) toolIds.add(block.id);
        addCall(block.id ?? '', block.name ?? 'tool', block.input ?? block.args ?? block.arguments, block.result, block.status === 'error', block.details); return '';
      }
      if (block.type === 'image' || block.type === 'audio' || block.type === 'tts_audio') {
        const file = chatMedia(block, blockId); if (file) inlineMedia.push(file); return '';
      }
      if (block.type === 'review') { blocks.push({ id: blockId, kind: 'review', text: '', review: chatReview(block) }); return ''; }
      return '';
    }).join('\n');
    if (Array.isArray(message.toolCalls)) message.toolCalls.forEach((call): void => {
      if (call.id) toolIds.add(call.id);
      addCall(call.id ?? '', call.name || 'tool', call.args, call.result, call.isError, call.details);
    });
    if (Array.isArray(message.tool_calls)) message.tool_calls.forEach((call): void => {
      if (toolIds.has(call.id)) return;
      toolIds.add(call.id); addCall(call.id, call.function.name || 'tool', call.function.arguments);
    });
    tools = calls.map((call: XopcChatTool): string => toolText(call.name, call.input, call.result)).join('');
    const media = chatAttachments((Array.isArray(message.media) ? message.media : []).concat(Array.isArray(message.attachments) ? message.attachments : [], chatHistoryAudio(message, rowId), inlineMedia), rowId);
    const review = chatReview(message.metadata?.review);
    if (review?.type === 'review' && !blocks.some((block: XopcChatBlock): boolean => block.kind === 'review')) blocks.push({ id: rowId + ':review', kind: 'review', text: '', review });
    const outcome = chatOutcome(message.metadata?.turnOutcome);
    const refs: XopcContextRef[] = (message.metadata?.sourceContexts || []).filter((ref): boolean => !!ref && ['note', 'task'].includes(ref.kind)
      && typeof ref.sourceId === 'string' && typeof ref.version === 'string')
      .map((ref): XopcContextRef => ({ kind: ref.kind, sourceId: ref.sourceId, expectedVersion: ref.version, title: ref.title }));
    if (text || thinking || tools || blocks.length || outcome || media.length || refs.length || message.role === 'tool' || message.role === 'toolResult') {
      const row: XopcChatRow = { id: rowId, role: message.role === 'user-with-attachments' ? 'user' : message.role,
        text: text.trim(), thinking: thinking.trim(), tools: tools.trim(), media, blocks, outcome, turnId: message.turnId };
      if (row.role === 'assistant') {
        blocks.forEach((block: XopcChatBlock): void => { if (block.kind === 'text' && !block.presentation) block.presentation = calls.length ? 'narration' : 'answer'; });
        refreshChatRow(row);
      }
      if (refs.length) row.refs = refs;
      if (calls.length) row.toolCalls = calls;
      if (message.role === 'tool' || message.role === 'toolResult') {
        row.toolResultId = message.toolCallId ?? message.tool_call_id ?? ''; row.toolResultError = message.isError === true;
        row.toolResultDetails = message.details;
      }
      rows.push(row);
    }
  });
  return mergeHistoryToolResults(rows);
}
