import { beforeEach, describe, expect, it } from 'vitest';

import {
  finishStreamingRenderMetrics,
  getStreamingRenderMetrics,
  recordStreamingCommit,
  recordStreamingDelta,
  recordStreamingParse,
  recordStreamingShape,
  recordStreamingTerminalFlush,
  resetStreamingRenderMetrics,
  startStreamingRenderMetrics,
} from '@/components/markdown/streaming-render-metrics';

describe('streaming render metrics', () => {
  beforeEach(() => resetStreamingRenderMetrics());

  it('records bounded numeric metadata without message content', () => {
    startStreamingRenderMetrics('message-1');
    recordStreamingDelta('message-1', 24);
    recordStreamingCommit('message-1', 24);
    recordStreamingParse('message-1', 3.5);
    recordStreamingShape('message-1', 2, 8);
    recordStreamingTerminalFlush('message-1', 12);
    finishStreamingRenderMetrics('message-1');

    expect(getStreamingRenderMetrics()).toEqual([
      expect.objectContaining({
        key: 'message-1',
        deltaCount: 1,
        commitCount: 1,
        parseCount: 1,
        averageParseMs: 3.5,
        latestParseMs: 3.5,
        stableBlockCount: 2,
        tailLength: 8,
        latestContentLength: 24,
        terminalBacklogChars: 12,
        active: false,
      }),
    ]);
    expect(JSON.stringify(getStreamingRenderMetrics())).not.toContain('message content');
  });
});
