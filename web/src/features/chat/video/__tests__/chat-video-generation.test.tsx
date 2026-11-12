// @vitest-environment jsdom

import { SEEDANCE_VIDEO_MODEL_REF, type VideoGenerationJob, type VideoGenerationSession } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { useChatVideoGeneration } from '../chat-video-generation';

const cache = vi.hoisted(() => ({
  data: undefined as VideoGenerationSession | undefined,
  mutate: vi.fn(),
}));
vi.mock('swr', () => ({ default: () => cache }));

it('starts polling when the first job appears and stops when it completes', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const root = createRoot(document.createElement('div'));
  const job: VideoGenerationJob = {
    id: 'job', transcriptId: 'transcript', modelRef: SEEDANCE_VIDEO_MODEL_REF,
    prompt: 'A boat', duration: 4, ratio: '16:9', resolution: '480P',
    state: 'queued', imageName: null, error: null, createdAt: 1,
  };
  function Harness({ jobs }: { jobs: VideoGenerationJob[] }) {
    cache.data = { transcriptId: 'transcript', modelRef: SEEDANCE_VIDEO_MODEL_REF, configured: true, defaults: { duration: 5, resolution: '720P' }, jobs };
    useChatVideoGeneration('conversation', 'en');
    return null;
  }
  try {
    act(() => root.render(<Harness jobs={[]} />));
    act(() => vi.advanceTimersByTime(3_000));
    expect(cache.mutate).not.toHaveBeenCalled();
    act(() => root.render(<Harness jobs={[job]} />));
    act(() => vi.advanceTimersByTime(3_000));
    expect(cache.mutate).toHaveBeenCalledTimes(1);
    act(() => root.render(<Harness jobs={[{ ...job, state: 'completed' }]} />));
    act(() => vi.advanceTimersByTime(3_000));
    expect(cache.mutate).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    visibility.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
