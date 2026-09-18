import { XopcChatRow, XopcChatBlock, XopcChatTool, XopcStreamPayload, XopcTurnOutcome } from '../model/chat';
import { chatResultText, chatOutcome, chatReview, refreshChatRow } from './chatRichContent';

interface XopcCommandInput { command: string; cwd?: string; }
interface XopcToolEventDetails { kind?: string; }

export function reduceChatStream(previous: XopcChatRow | undefined, event: string, payload: XopcStreamPayload, runId: string): XopcChatRow {
  // Copy mutable shells only. Tool payloads and media bytes are immutable inputs;
  // serializing the entire accumulated reply per token makes long turns quadratic.
  const row: XopcChatRow = previous ? { id: previous.id, role: previous.role, text: previous.text,
    thinking: previous.thinking, tools: previous.tools, toolCalls: previous.toolCalls, refs: previous.refs, outcome: previous.outcome,
    turnId: previous.turnId, live: previous.live, progress: previous.progress, sourceIds: previous.sourceIds,
    media: previous.media?.slice(), blocks: previous.blocks?.map((block: XopcChatBlock): XopcChatBlock => ({
      id: block.id, kind: block.kind, text: block.text, segmentId: block.segmentId, presentation: block.presentation,
      active: block.active, file: block.file, review: block.review, plan: block.plan,
      call: block.call ? { id: block.call.id, name: block.call.name, input: block.call.input, result: block.call.result,
        isError: block.call.isError, status: block.call.status, details: block.call.details } : undefined })) }
    : { id: 'live:' + runId, role: 'assistant', text: '', blocks: [], live: true };
  const blocks = row.blocks || [];
  const settleThinking = (): void => { blocks.forEach((block: XopcChatBlock): void => { if (block.kind === 'thinking') block.active = false; }); };
  if (event === 'assistant_delta' || event === 'thinking_delta') {
    const kind = event === 'assistant_delta' ? 'text' : 'thinking';
    if (kind === 'text') settleThinking();
    const segment = payload.messageId || '';
    let target = segment ? blocks.find((block: XopcChatBlock): boolean => block.kind === kind && block.segmentId === segment) : undefined;
    const last = blocks[blocks.length - 1];
    if (!target && !segment && last?.kind === kind && !last.segmentId) target = last;
    if (!target) {
      target = { id: row.id + ':' + kind + ':' + (segment || blocks.length), kind, text: '', segmentId: segment || undefined, presentation: 'pending' };
      blocks.push(target);
    }
    target.text += payload.delta || ''; target.active = kind === 'thinking';
  } else if (event === 'thinking_end') settleThinking();
  else if (event === 'assistant_message_end') {
    settleThinking();
    blocks.forEach((block: XopcChatBlock): void => {
      if (block.kind === 'text' && (!payload.messageId || block.segmentId === payload.messageId)) block.presentation = payload.presentation === 'narration' ? 'narration' : 'answer';
    });
  } else if (['tool_start', 'tool_update', 'tool_end', 'command_started', 'command_output_delta', 'command_completed', 'patch_applied'].includes(event)) {
    const details = payload.details as XopcToolEventDetails | undefined;
    // Command events carry the same output as generic updates; consume only their dedicated stream.
    if (event === 'tool_update' && details?.kind === 'command_output_delta') return row;
    settleThinking();
    const name = event.startsWith('command_') ? 'exec_command' : event === 'patch_applied' ? 'apply_patch' : payload.toolName || 'tool';
    const id = payload.toolCallId || '';
    let target = id ? blocks.find((block: XopcChatBlock): boolean => block.call?.id === id) : undefined;
    if (!id) {
      const pending = blocks.filter((block: XopcChatBlock): boolean => block.call?.name === name && block.call.status === 'running');
      if (pending.length === 1) target = pending[0];
    }
    if (!target) {
      const call: XopcChatTool = { id: id || row.id + ':tool:' + blocks.length, name, status: 'running' };
      target = { id: 'tool:' + call.id, kind: 'tool', text: '', call }; blocks.push(target);
    }
    const call = target.call!;
    if (event === 'tool_end' && call.name === 'exec_command' && call.status !== 'running') return row;
    if (event === 'tool_end' && call.name === 'apply_patch' && call.status === 'done' && payload.status !== 'error') return row;
    if (payload.args !== undefined) call.input = payload.args;
    if (payload.details !== undefined) call.details = payload.details;
    if (event === 'command_started') { const input: XopcCommandInput = { command: payload.command || '', cwd: payload.cwd }; call.input = input; }
    if (event === 'tool_update' && payload.textDelta) call.result = (call.result || '') + payload.textDelta;
    if (event === 'command_output_delta') call.result = (call.result || '') + (payload.delta || '');
    if (event === 'tool_end') {
      call.status = payload.status === 'error' || payload.status === 'cancelled' ? 'error' : 'done';
      call.isError = call.status === 'error'; if (payload.result !== undefined) call.result = chatResultText(payload.result);
    }
    if (event === 'command_completed') {
      call.isError = payload.timedOut === true || (typeof payload.exitCode === 'number' && payload.exitCode !== 0);
      call.status = call.isError ? 'error' : 'done'; call.details = payload;
    }
    if (event === 'patch_applied') { call.status = 'done'; call.result = payload.diff || ''; call.details = payload; }
  } else if (event === 'turn_plan' || event === 'turn_diff') {
    const kind = event === 'turn_plan' ? 'plan' : 'diff';
    const id = row.id + ':' + kind; const index = blocks.findIndex((block: XopcChatBlock): boolean => block.id === id);
    const block: XopcChatBlock = { id, kind, text: kind === 'diff' ? payload.diff || '' : payload.explanation || '',
      plan: Array.isArray(payload.plan) ? payload.plan.filter((step): boolean => !!step && typeof step.step === 'string' && ['pending', 'in_progress', 'completed'].includes(step.status)) : undefined };
    if (kind === 'plan' && !block.plan?.length) return row;
    if (kind === 'diff' && !block.text.trim()) return row;
    if (index < 0) blocks.push(block); else blocks[index] = block;
  } else if (event === 'tts_audio' && typeof payload.uri === 'string' && payload.uri) {
    const media = row.media || [];
    if (!media.some((file): boolean => file.uri === payload.uri)) media.push({ id: row.id + ':audio:' + media.length,
      name: payload.name || 'voice.mp3', type: 'audio', mimeType: payload.mimeType || 'audio/mpeg', size: 0, uri: payload.uri });
    row.media = media;
  } else if (event === 'review' && payload.review?.type === 'review') {
    const id = row.id + ':review'; const index = blocks.findIndex((block: XopcChatBlock): boolean => block.id === id);
    const review: XopcChatBlock = { id, kind: 'review', text: '', review: chatReview(payload.review) };
    if (index < 0) blocks.push(review); else blocks[index] = review;
  } else if (event === 'turn_outcome') row.outcome = chatOutcome(payload as Object as XopcTurnOutcome);
  else if (event === 'progress' || event === 'compaction') row.progress = payload.message || '';
  else if (event === 'run_end') {
    row.live = false; settleThinking(); row.progress = '';
    blocks.forEach((block: XopcChatBlock): void => {
      if (block.call?.status === 'running') block.call.status = payload.status === 'cancelled' || payload.status === 'error' ? 'error' : 'done';
    });
  }
  row.blocks = blocks;
  return refreshChatRow(row);
}
