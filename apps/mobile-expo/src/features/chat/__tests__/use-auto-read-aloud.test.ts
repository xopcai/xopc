import { describe, expect, it, vi } from 'vitest';

vi.mock('../../voice/read-aloud-store', () => ({
  useReadAloudStore: vi.fn(),
}));

import type { Message } from '../messages.types';
import {
  advanceAutoReadAloud,
  findLatestAutoReadAloudCandidate,
  type AutoReadAloudTracker,
} from '../use-auto-read-aloud';

function assistant(text: string, id: string, withAudio = false): Message {
  return {
    id,
    role: 'assistant',
    content: [
      { type: 'text', text, presentation: 'answer' },
      ...(withAudio ? [{ type: 'audio' as const, uri: '/reply.mp3' }] : []),
    ],
  };
}

describe('automatic read aloud', () => {
  it('does not replay history and reads a newly completed assistant reply once', () => {
    const history = findLatestAutoReadAloudCandidate({
      messages: [assistant('Old reply', 'old')],
      sessionKey: 'main',
      language: 'en',
      title: 'AI response',
    });
    let tracker = advanceAutoReadAloud(undefined, {
      sessionKey: 'main',
      enabled: true,
      streaming: false,
      candidate: history,
    }).tracker;

    tracker = advanceAutoReadAloud(tracker, {
      sessionKey: 'main',
      enabled: true,
      streaming: true,
      candidate: history,
    }).tracker;
    const reply = findLatestAutoReadAloudCandidate({
      messages: [assistant('Old reply', 'old'), assistant('New reply', 'new')],
      sessionKey: 'main',
      language: 'en',
      title: 'AI response',
    });
    const completed = advanceAutoReadAloud(tracker, {
      sessionKey: 'main',
      enabled: true,
      streaming: false,
      candidate: reply,
    });

    expect(completed.input?.text).toBe('New reply');
    expect(completed.input?.source.preview).toBe('New reply');
    expect(advanceAutoReadAloud(completed.tracker, {
      sessionKey: 'main',
      enabled: true,
      streaming: false,
      candidate: reply,
    }).input).toBeNull();
  });

  it('baselines replies received while disabled', () => {
    const oldCandidate = findLatestAutoReadAloudCandidate({
      messages: [assistant('Old reply', 'old')],
      sessionKey: 'main',
      language: 'en',
      title: 'AI response',
    });
    let tracker: AutoReadAloudTracker = {
      sessionKey: 'main',
      enabled: false,
      wasStreaming: true,
      lastSeenKey: oldCandidate?.key ?? null,
    };
    const newCandidate = findLatestAutoReadAloudCandidate({
      messages: [assistant('New reply', 'new')],
      sessionKey: 'main',
      language: 'en',
      title: 'AI response',
    });

    tracker = advanceAutoReadAloud(tracker, {
      sessionKey: 'main',
      enabled: false,
      streaming: false,
      candidate: newCandidate,
    }).tracker;
    const enabled = advanceAutoReadAloud(tracker, {
      sessionKey: 'main',
      enabled: true,
      streaming: false,
      candidate: newCandidate,
    });

    expect(enabled.input).toBeNull();
    expect(enabled.tracker.lastSeenKey).toBe(newCandidate?.key);
  });

  it('reads the current reply when enabled before streaming completes', () => {
    let tracker: AutoReadAloudTracker = {
      sessionKey: 'main',
      enabled: false,
      wasStreaming: true,
      lastSeenKey: null,
    };
    tracker = advanceAutoReadAloud(tracker, {
      sessionKey: 'main',
      enabled: true,
      streaming: true,
      candidate: null,
    }).tracker;
    const reply = findLatestAutoReadAloudCandidate({
      messages: [assistant('Current reply', 'current')],
      sessionKey: 'main',
      language: 'en',
      title: 'AI response',
    });

    const completed = advanceAutoReadAloud(tracker, {
      sessionKey: 'main',
      enabled: true,
      streaming: false,
      candidate: reply,
    });

    expect(completed.input?.text).toBe('Current reply');
  });

  it('does not synthesize a second voice track for an audio reply', () => {
    const candidate = findLatestAutoReadAloudCandidate({
      messages: [assistant('Spoken reply', 'audio', true)],
      sessionKey: 'main',
      language: 'en',
      title: 'AI response',
    });

    expect(candidate?.input).toBeNull();
  });
});
