import { describe, expect, it } from 'vitest';
import { historyRows } from '../entry/src/main/ets/common/chatProtocol.ets';
import { chatActivities, chatDeliveries, chatOutcome, mergeAssistantRows, toolOutputText, chatReview, chatSearchLinks, chatAnswerText, chatProductCapability, chatAttachments } from '../entry/src/main/ets/common/chatRichContent.ets';
import { reduceChatStream } from '../entry/src/main/ets/common/chatStream.ets';
import type { XopcChatRow, XopcMessage } from '../entry/src/main/ets/model/chat.ets';

const parse = (messages: XopcMessage[]) => mergeAssistantRows(historyRows({ session: { key: 's', messages }, pagination: { hasMore: false } }));
const artifact = { artifactId: 'a', title: 'image.png', kind: 'image', availability: 'available', uri: 'xopc-file:a' };
const outcome = { version: 1, outcomeId: 'o', runId: 'r', turnId: 't', status: 'succeeded', deliverables: [artifact] };
describe('rich chat parity projection', () => {
  it('keeps prior stream snapshots immutable without serializing large tool inputs per delta', () => {
    const input = { script: 'x'.repeat(200000) };
    const previous = reduceChatStream(undefined, 'tool_start', { toolCallId: 't', toolName: 'exec', args: input }, 'r');
    const next = reduceChatStream(previous, 'tool_update', { toolCallId: 't', toolName: 'exec', textDelta: 'output' }, 'r');
    expect(previous.blocks?.[0].call?.result).toBeUndefined();
    expect(next.blocks?.[0].call?.result).toBe('output');
    expect(next.blocks?.[0].call?.input).toBe(input);
    const done = reduceChatStream(next, 'run_end', { status: 'cancelled' }, 'r');
    expect(next.blocks?.[0].call?.status).toBe('running'); expect(done.blocks?.[0].call?.status).toBe('error');
  });
  it.each(['ttsAudio', 'tts_audio', 'tts', 'audio'])('preserves historical voice-only messages from %s', key => {
    const rows = parse([{ id: 'voice', role: 'assistant', content: '', [key]: ['media://a', { url: 'media://b', mime_type: 'audio/wav', name: 'speech.wav' }] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].media?.map(file => file.uri)).toEqual(['media://a', 'media://b']);
    expect(rows[0].media?.[1]).toMatchObject({ mimeType: 'audio/wav', name: 'speech.wav' });
  });
  it.each(['ttsAudioUri', 'tts_audio_uri', 'audioUri', 'audio_url'])('normalizes the historical %s URI alias', key => {
    expect(parse([{ role: 'assistant', content: '', [key]: ' media://speech ', mime_type: 'audio/ogg', name: 'voice.ogg' }])[0].media?.[0])
      .toMatchObject({ uri: 'media://speech', mimeType: 'audio/ogg', name: 'voice.ogg' });
  });
  it('deduplicates voice aliases against inline audio and accepts scoped or embedded speech', () => {
    const row = parse([{ role: 'assistant', content: [{ type: 'audio', uri: 'media://speech', name: 'inline.mp3' }],
      ttsAudio: ['media://speech', { workspace_relative_path: 'voice/output.mp3' }, { data: 'Y Q==', mimeType: 'audio/wav' }, null as never, 4 as never, {}] }])[0];
    expect(row.media).toHaveLength(3);
    expect(row.media?.[0].name).toBe('inline.mp3');
    expect(row.media?.[1].workspaceRelativePath).toBe('voice/output.mp3');
    expect(row.media?.[2].uri).toBe('data:audio/wav;base64,YQ==');
  });
  it('honors product capabilities and normalizes legacy attachment metadata', () => {
    expect(chatProductCapability({ kind: 'note', id: 'n', title: 'Note', capabilities: ['continue_in_chat'] }, 'open')).toBe(false);
    expect(chatProductCapability({ kind: 'note', id: 'n', title: 'Note', capabilities: ['open'] }, 'open')).toBe(true);
    expect(chatProductCapability({ kind: 'note', id: 'n', title: 'Note', capabilities: 'open' as never }, 'open')).toBe(false);
    expect(chatAttachments([{ name: 'photo.jpg', data: 'YWJj' } as never], 'r')[0]).toMatchObject({ id: 'r:0', mimeType: 'image/jpeg', type: 'image', uri: 'data:image/jpeg;base64,YWJj' });
  });
  it('preserves ordered thinking/tool/text across assistant fragments and ignores system/unknown roles', () => {
    const rows = parse([{ role: 'system', content: 'secret' }, { id: 'a', role: 'assistant', content: [
      { type: 'thinking', thinking: 'plan' }, { type: 'toolCall', id: 'c', name: 'read_file' }, { type: 'text', text: 'narration' }], turnId: 't' },
    { role: 'toolResult', toolCallId: 'c', content: 'read result' }, { id: 'b', role: 'assistant', content: 'answer', turnId: 't' }]);
    expect(rows).toHaveLength(1); expect(rows[0].blocks?.map(b => b.kind)).toEqual(['thinking', 'tool', 'text', 'text']);
    expect(rows[0].toolCalls?.[0].status).toBe('done'); expect(rows[0].text).toBe('narration\nanswer');
    expect(chatActivities(rows[0], 'off')).toHaveLength(1);
  });
  it('does not merge across user or explicit turn identities', () => {
    expect(parse([{ role: 'assistant', content: 'one', turnId: '1' }, { role: 'assistant', content: 'two', turnId: '2' }])).toHaveLength(2);
    expect(parse([{ role: 'assistant', content: 'one' }, { role: 'user', content: 'two' }, { role: 'assistant', content: 'three' }])).toHaveLength(3);
  });
  it('retains pagination anchors when an earlier fragment joins the visible assistant turn', () => {
    const latest = parse([{ id: 'final', role: 'assistant', turnId: 't', content: 'answer' }]);
    const merged = mergeAssistantRows([...parse([{ id: 'earlier', role: 'assistant', turnId: 't', content: [{ type: 'thinking', thinking: 'plan' }] }]), ...latest]);
    expect(merged).toHaveLength(1); expect(merged[0].sourceIds).toEqual(['earlier', 'final']); expect(merged[0].text).toBe('answer');
  });
  it('keeps review-only and outcome-only messages, decodes inline images instead of type placeholders', () => {
    const rows = parse([{ role: 'assistant', content: [], metadata: { turnOutcome: outcome, review: { type: 'review', target: 'src', findings: [] } } },
      { role: 'user', content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }] }]);
    expect(rows[0].outcome?.deliverables).toEqual([artifact]); expect(rows[0].blocks?.[0].kind).toBe('review');
    expect(rows[1].text).toBe(''); expect(rows[1].media?.[0].uri).toBe('data:image/png;base64,YWJj');
  });
  it('filters malformed artifacts and prefers available source snapshots', () => {
    expect(chatOutcome({ ...outcome, deliverables: [null as never, artifact, { ...artifact, artifactId: 'b', sourceFileId: 'shared', availability: 'available' },
      { ...artifact, artifactId: 'c', sourceFileId: 'shared', availability: 'missing' }] })?.deliverables.map(a => a.artifactId)).toEqual(['a', 'b']);
    expect(chatOutcome({ ...outcome, version: 9 })).toBeUndefined();
  });
  it('extracts business deliveries from both structured details and persisted text markers', () => {
    const delivery = { version: 1, operation: 'created', primary: { kind: 'note', id: 'n', title: 'Plan' } };
    const row: XopcChatRow = { id: 'r', role: 'assistant', text: '', toolCalls: [
      { id: 'a', name: 'xopc_use', status: 'done', details: { delivery } },
      { id: 'b', name: 'xopc_use', result: 'xopc-product-delivery:' + encodeURIComponent(JSON.stringify(delivery)) },
      { id: 'c', name: 'xopc_use', isError: true, details: { delivery }, result: 'failed' }] };
    expect(chatDeliveries(row)).toEqual([delivery]);
    expect(toolOutputText({ id: 't', name: 'read', result: JSON.stringify({ content: [{ type: 'text', text: 'hello' }] }) })).toBe('hello');
  });
});
describe('rich live event reducer', () => {
  it('does not add empty plan or diff steps, or erase a valid plan on an invalid update', () => {
    let row = reduceChatStream(undefined, 'turn_plan', { plan: [] }, 'r');
    row = reduceChatStream(row, 'turn_diff', { diff: '  ' }, 'r');
    expect(row.blocks).toEqual([]);
    row = reduceChatStream(row, 'turn_plan', { plan: [{ step: 'Inspect', status: 'pending' }] }, 'r');
    row = reduceChatStream(row, 'turn_plan', { plan: [{ step: 'Invalid', status: 'unknown' }] }, 'r');
    expect(row.blocks?.[0].plan).toEqual([{ step: 'Inspect', status: 'pending' }]);
  });
  it('avoids command output duplication and keeps specialized command completion authoritative', () => {
    let row = reduceChatStream(undefined, 'command_started', { toolCallId: 'c', command: 'test' }, 'r');
    row = reduceChatStream(row, 'tool_update', { toolCallId: 'c', toolName: 'exec_command', textDelta: 'ok', details: { kind: 'command_output_delta' } }, 'r');
    row = reduceChatStream(row, 'command_output_delta', { toolCallId: 'c', delta: 'ok' }, 'r');
    row = reduceChatStream(row, 'command_completed', { toolCallId: 'c', exitCode: 2 }, 'r');
    row = reduceChatStream(row, 'tool_end', { toolCallId: 'c', toolName: 'exec_command', status: 'success', result: 'wrapper' }, 'r');
    expect(row.toolCalls?.[0]).toMatchObject({ result: 'ok', status: 'error' });
  });
  it('updates plans in place and retains TTS media without duplication', () => {
    let row = reduceChatStream(undefined, 'turn_plan', { plan: [{ step: 'Test', status: 'pending' }] }, 'r');
    row = reduceChatStream(row, 'turn_plan', { plan: [{ step: 'Test', status: 'completed' }] }, 'r');
    row = reduceChatStream(row, 'tts_audio', { uri: 'media://voice' }, 'r');
    row = reduceChatStream(row, 'tts_audio', { uri: 'media://voice' }, 'r');
    expect(row.blocks).toHaveLength(1); expect(row.blocks?.[0].plan?.[0].status).toBe('completed'); expect(row.media).toHaveLength(1);
  });
  it('normalizes broken review findings and unsafe search links', () => {
    expect(chatReview({ type: 'review', findings: [null, { title: 'bad' }, { title: 'ok', body: 'body', priority: 1 }] } as never)?.findings).toHaveLength(1);
    expect(chatSearchLinks({ id: 'c', name: 'web_search', details: { results: [{ url: 'javascript:bad', title: 'bad' }, { url: 'https://example.com', title: 'good' }, { url: 'https://example.com' }] } })).toEqual([{ url: 'https://example.com', title: 'https://example.com' }]);
  });
  it('reads only the final answer rather than intermediate narration', () => {
    const rows = parse([{ role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'toolCall', id: 'c', name: 'read' }] },
      { role: 'toolResult', toolCallId: 'c', content: 'output' }, { role: 'assistant', content: 'answer' }]);
    expect(chatAnswerText(rows[0])).toBe('answer');
  });
  it('separates model segments, settles thinking and matches parallel tools by ID', () => {
    let row = reduceChatStream(undefined, 'thinking_delta', { messageId: 'm1', delta: 'consider' }, 'run');
    row = reduceChatStream(row, 'tool_start', { toolCallId: 'a', toolName: 'read', args: { path: 'a' } }, 'run');
    row = reduceChatStream(row, 'tool_start', { toolCallId: 'b', toolName: 'read' }, 'run');
    row = reduceChatStream(row, 'tool_end', { toolCallId: 'b', toolName: 'read', status: 'error', result: 'failure' }, 'run');
    row = reduceChatStream(row, 'assistant_delta', { messageId: 'm2', delta: 'answer' }, 'run');
    expect(row.blocks?.[0].active).toBe(false); expect(row.toolCalls?.map(t => t.status)).toEqual(['running', 'error']);
    expect(row.text).toBe('answer'); expect(row.thinking).toBe('consider');
  });
  it('retains command output, patches, reviews and outcome through terminal events', () => {
    let row = reduceChatStream(undefined, 'command_started', { toolCallId: 'c', command: 'test' }, 'run');
    row = reduceChatStream(row, 'command_output_delta', { toolCallId: 'c', delta: 'passed' }, 'run');
    row = reduceChatStream(row, 'command_completed', { toolCallId: 'c', exitCode: 0 }, 'run');
    row = reduceChatStream(row, 'patch_applied', { toolCallId: 'p', diff: '+new\n-old' }, 'run');
    row = reduceChatStream(row, 'review', { review: { type: 'review', target: 'patch', findings: [] } }, 'run');
    row = reduceChatStream(row, 'turn_outcome', outcome as never, 'run');
    row = reduceChatStream(row, 'run_end', { status: 'succeeded' }, 'run');
    expect(row.live).toBe(false); expect(row.toolCalls?.[0].result).toBe('passed'); expect(row.outcome).toMatchObject(outcome);
    expect(row.blocks?.map(b => b.kind)).toEqual(['tool', 'tool', 'review']);
  });
  it('does not mutate previous projections or duplicate tool identities during paired specialized events', () => {
    const previous = reduceChatStream(undefined, 'tool_start', { toolCallId: 'c', toolName: 'exec_command' }, 'run');
    const current = reduceChatStream(previous, 'command_started', { toolCallId: 'c', command: 'test' }, 'run');
    expect(previous.toolCalls?.[0].input).toBeUndefined(); expect(current.toolCalls).toHaveLength(1);
  });
});
