import { describe, expect, it, vi } from 'vitest';
import { advanceAssistantAudio, latestAssistantAudio, XopcAssistantAudioItem,
  XopcAssistantAudioQueue } from '../entry/src/main/ets/common/assistantAudioAutoplay.ets';

const item = (key: string): XopcAssistantAudioItem => ({ key, conversationId: 'main',
  file: { id: key, name: key + '.mp3', type: 'audio', mimeType: 'audio/mpeg', size: 1, uri: 'media://' + key } });

describe('Harmony assistant audio autoplay', () => {
  it('establishes history as a baseline and emits only after a live completion edge', () => {
    const history = [{ id: 'old-row', role: 'assistant', text: '', media: [item('old').file] }];
    const baseline = advanceAssistantAudio(undefined, 'main', true, false, latestAssistantAudio(history, 'main'));
    expect(baseline.candidate).toBeUndefined();
    const streaming = advanceAssistantAudio(baseline.state, 'main', true, true, latestAssistantAudio(history, 'main'));
    const rows = history.concat([{ id: 'new-row', role: 'assistant', text: '', media: [item('new').file] }]);
    const completed = advanceAssistantAudio(streaming.state, 'main', true, false, latestAssistantAudio(rows, 'main'));
    expect(completed.candidate?.file.id).toBe('new');
    expect(advanceAssistantAudio(completed.state, 'main', true, false, completed.candidate).candidate).toBeUndefined();
  });

  it('serializes tracks, deduplicates delivery and drops pending audio after interruption', async () => {
    const finishes: Array<(result: 'completed' | 'interrupted') => void> = [];
    const play = vi.fn(() => new Promise<'completed' | 'interrupted'>((resolve) => finishes.push(resolve)));
    const queue = new XopcAssistantAudioQueue(play);
    queue.enqueue(item('first')); queue.enqueue(item('second')); queue.enqueue(item('second'));
    expect(play).toHaveBeenCalledTimes(1);
    finishes.shift()!('completed');
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    queue.enqueue(item('stale')); finishes.shift()!('interrupted');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('continues after one track fails', async () => {
    const play = vi.fn().mockRejectedValueOnce(new Error('download failed')).mockResolvedValue('completed');
    const queue = new XopcAssistantAudioQueue(play);
    queue.enqueue(item('broken')); queue.enqueue(item('next'));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  });
});
