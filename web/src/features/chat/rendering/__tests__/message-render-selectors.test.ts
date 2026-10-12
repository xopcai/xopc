import { beforeEach, describe, expect, it } from 'vitest';

import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { appendTextDelta, appendToolStart, completeTool } from '@/features/chat/messages/streaming';

import { createMessageShellSelector, createSessionShellSelector, selectContentPart, selectMessageRow } from '../message-render-selectors';
import { knownPartRenderKey } from '../part-identity';
import { RenderCache } from '../render-cache';

const store = () => useChatSessionStore.getState();
describe('chat rendering snapshots', () => {
  beforeEach(() => {
    useChatSessionStore.setState({ sessions: {} });
    store().initSessionSnapshot('chat', { ...defaultSessionMeta(), historyStatus: 'ready', messages: [], hasMore: false,
      streamingMsg: null, streaming: false, sending: false, progress: null, taskPlan: null });
  });

  it('keeps page/row shells and completed parts stable while only text grows', () => {
    store().mutateSessionStreaming('chat', message => {
      message.content.push({ type: 'text', text: 'Intro', segmentId: 'intro', presentation: 'narration' });
      message.content.push({ type: 'tool_use', id: 'tool', name: 'read_file', status: 'done' });
      message.content.push({ type: 'text', text: 'Answer', segmentId: 'answer' });
    });
    const before = store().sessions.chat;
    const row = before.streamingMsg!;
    const partId = knownPartRenderKey(row.content[2])!;
    const shell = createSessionShellSelector();
    const rowShell = createMessageShellSelector();
    const firstShell = shell(before);
    const firstRow = rowShell(selectMessageRow(before, row.renderKey!));
    store().mutateSessionStreaming('chat', message => appendTextDelta(message.content, ' grows', 'answer'));
    const after = store().sessions.chat;
    expect(after.messages).toBe(before.messages);
    expect(after.streamingMsg!.content[0]).toBe(row.content[0]);
    expect(after.streamingMsg!.content[1]).toBe(row.content[1]);
    expect(knownPartRenderKey(after.streamingMsg!.content[2])).toBe(partId);
    expect(shell(after)).toBe(firstShell);
    expect(rowShell(selectMessageRow(after, row.renderKey!))).toBe(firstRow);
    expect(selectContentPart(after, partId)).toMatchObject({ text: 'Answer grows' });
    expect(row.content[2]).toMatchObject({ text: 'Answer' });
  });

  it('does publish tool status changes and preserves identity at completion', () => {
    store().mutateSessionStreaming('chat', message => appendToolStart(message.content, 'read_file', {}, 'tool', 1));
    const before = store().sessions.chat;
    const partId = knownPartRenderKey(before.streamingMsg!.content[0])!;
    const shell = createSessionShellSelector();
    shell(before);
    store().mutateSessionStreaming('chat', message => completeTool(message.content, 'read_file', false, 'result', 'tool', 2));
    expect(shell(store().sessions.chat)).not.toBe(before);
    const live = store().sessions.chat.streamingMsg!;
    store().finalizeStreamingTurn('chat', live);
    expect(selectContentPart(store().sessions.chat, partId)).toMatchObject({ status: 'done' });
  });

  it('does not confuse identical text parts or leak identities into payloads', () => {
    store().mutateSessionStreaming('chat', message => {
      message.content.push({ type: 'text', text: 'same' }, { type: 'text', text: 'same' });
    });
    const content = store().sessions.chat.streamingMsg!.content;
    expect(knownPartRenderKey(content[0])).not.toBe(knownPartRenderKey(content[1]));
    expect(JSON.stringify(content)).toBe('[{"type":"text","text":"same"},{"type":"text","text":"same"}]');
  });

  it('evicts generated markup by bytes and LRU order', () => {
    const cache = new RenderCache(24, 2);
    cache.set('a', '111'); cache.set('b', '222');
    cache.get('a'); cache.set('c', '333');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('111');
    cache.set('large', 'x'.repeat(100));
    expect(cache.get('large')).toBeUndefined();
    expect(cache.sizeBytes).toBeLessThanOrEqual(24);
  });
});
