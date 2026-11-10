import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginResponseLatency, bindResponseLatency, discardPendingResponseLatency, finishResponseLatency, getResponseLatencyMetrics,
  hasCompleteOpeningSentence, markResponseSubmission, recordResponseText, recordResponseVisible, resetResponseLatencyMetrics,
} from '../response-latency';

afterEach(() => { vi.restoreAllMocks(); resetResponseLatencyMetrics(); });

describe('response latency measurement', () => {
  it('measures local input, text and visible sentence separately without storing content', () => {
    let timestamp = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => timestamp);
    const timing = beginResponseLatency('conversation', 90);
    timestamp = 115;
    markResponseSubmission(timing, 'endpointClaimMs', 100);
    timestamp = 120;
    markResponseSubmission(timing, 'postStartedMs');
    timestamp = 140;
    markResponseSubmission(timing, 'postStartedMs'); // Retries preserve the first POST start.
    timestamp = 175;
    markResponseSubmission(timing, 'postResponseMs');
    timestamp = 200;
    bindResponseLatency('conversation', 'run', timing);
    timestamp = 500;
    recordResponseText('run');
    timestamp = 550;
    recordResponseVisible('run', '先看');
    timestamp = 600;
    recordResponseVisible('run', '先看结论。后续');
    finishResponseLatency('run', 'cancelled');
    expect(getResponseLatencyMetrics()).toEqual([{ runId: 'run', senderStartedMs: 10, endpointClaimMs: 15, postStartedMs: 30,
      postResponseMs: 85, runBoundMs: 110, firstTextMs: 410,
      firstVisibleMs: 460, firstSentenceMs: 510, firstRenderLagMs: 50, status: 'cancelled' }]);
    timestamp = 900;
    recordResponseText('run');
    recordResponseVisible('run', '再补充。');
    expect(getResponseLatencyMetrics()[0]?.firstVisibleMs).toBe(460);
    expect(JSON.stringify(getResponseLatencyMetrics())).not.toContain('先看');
  });

  it('does not classify resumed history or silent output as a new response', () => {
    bindResponseLatency('history', 'old-run', beginResponseLatency('other'));
    recordResponseText('old-run');
    recordResponseVisible('old-run', 'Old result.');
    expect(getResponseLatencyMetrics()).toEqual([]);
    bindResponseLatency('new', 'new-run', beginResponseLatency('new'));
    recordResponseText('new-run');
    recordResponseVisible('new-run', 'NO_REPLY');
    finishResponseLatency('new-run', 'error');
    expect(getResponseLatencyMetrics()[0]).not.toHaveProperty('firstVisibleMs');
    expect(getResponseLatencyMetrics()[0]?.status).toBe('error');
  });

  it.each(['数值是 1.009', 'See Dr. Smith', 'Use version 1.2', '```ts\nreturn 1;', '| item | value |', '## Result'])
    ('does not use structured content or decimals as a sentence boundary: %s', (text) => {
      expect(hasCompleteOpeningSentence(text)).toBe(false);
    });
  it.each(['这项结果检验轨道衰减。', '先核对一下！', 'The result is 1.009.', 'It is ready. More follows.'])
    ('recognizes a complete opening sentence: %s', (text) => expect(hasCompleteOpeningSentence(text, true)).toBe(true));

  it('waits to disambiguate a trailing period from a decimal split across deltas', () => {
    expect(hasCompleteOpeningSentence('The value is 1.')).toBe(false);
    expect(hasCompleteOpeningSentence('The value is 1.009')).toBe(false);
    expect(hasCompleteOpeningSentence('The value is 1.009.\n\nDetails')).toBe(true);
  });

  it('bounds retained measurements', () => {
    for (let index = 0; index < 45; index++) {
      bindResponseLatency(`chat-${index}`, `run-${index}`, beginResponseLatency(`chat-${index}`));
    }
    expect(getResponseLatencyMetrics()).toHaveLength(40);
  });

  it('clears an unassigned failed input without discarding a newer input', () => {
    let timestamp = 1;
    vi.spyOn(performance, 'now').mockImplementation(() => timestamp);
    const rejected = beginResponseLatency('chat');
    discardPendingResponseLatency('chat', rejected);
    bindResponseLatency('chat', 'history', rejected);
    expect(getResponseLatencyMetrics()).toHaveLength(0);
    timestamp = 2;
    const newer = beginResponseLatency('chat');
    discardPendingResponseLatency('chat', rejected);
    bindResponseLatency('chat', 'stale-run', rejected);
    bindResponseLatency('chat', 'new-run', newer);
    expect(getResponseLatencyMetrics()).toEqual([{ runId: 'new-run', senderStartedMs: 0, runBoundMs: 0 }]);
  });
});
