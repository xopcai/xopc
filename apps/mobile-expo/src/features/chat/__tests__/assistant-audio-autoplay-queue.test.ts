import { describe, expect, it, vi } from 'vitest';

import {
  AssistantAudioAutoplayQueue,
  type AssistantAudioAutoplayResult,
} from '../assistant-audio-autoplay-queue';

const item = (key: string) => ({ key, uri: `media://${key}`, sessionKey: 'main' });

describe('assistant audio autoplay queue', () => {
  it('plays consecutive replies in order and ignores duplicate delivery', async () => {
    const releases: Array<(result: AssistantAudioAutoplayResult) => void> = [];
    const play = vi.fn(() => new Promise<AssistantAudioAutoplayResult>((resolve) => releases.push(resolve)));
    const queue = new AssistantAudioAutoplayQueue(play);

    queue.enqueue(item('first'));
    queue.enqueue(item('second'));
    queue.enqueue(item('second'));
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenNthCalledWith(1, item('first'));

    releases.shift()!('completed');
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(play).toHaveBeenNthCalledWith(2, item('second'));
    releases.shift()!('completed');
  });

  it('drops stale queued speech when another playback interrupts it', async () => {
    let finish!: (result: AssistantAudioAutoplayResult) => void;
    const play = vi.fn(() => new Promise<AssistantAudioAutoplayResult>((resolve) => { finish = resolve; }));
    const queue = new AssistantAudioAutoplayQueue(play);

    queue.enqueue(item('first'));
    queue.enqueue(item('stale'));
    finish('interrupted');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(play).toHaveBeenCalledOnce();
  });

  it('continues after a single track fails', async () => {
    const play = vi.fn()
      .mockRejectedValueOnce(new Error('download failed'))
      .mockResolvedValue('completed');
    const queue = new AssistantAudioAutoplayQueue(play);

    queue.enqueue(item('broken'));
    queue.enqueue(item('next'));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(play).toHaveBeenLastCalledWith(item('next'));
  });
});
