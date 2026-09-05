import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StreamingSttEvent } from '../../../media-understanding/types.js';
import type { VoiceEngine } from '../engine.js';
import type { VoiceRealtimeRuntimeOptions } from '../runtime.js';

const mocks = vi.hoisted(() => ({ speak: vi.fn() }));
vi.mock('../../tts/speak-core.js', () => ({ speakStream: mocks.speak }));

import { createAgentVoiceEngine } from '../agentEngine.js';

describe('Agent voice interruption cleanup', () => {
  let engine: VoiceEngine;
  const cleanups: Array<() => void> = [];
  afterEach(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); await engine?.close(); vi.clearAllMocks(); });

  async function setup(runAgent: VoiceRealtimeRuntimeOptions['runAgent'], bargeIn = true) {
    let emit!: (event: StreamingSttEvent) => void;
    const send = vi.fn();
    const sendAudio = vi.fn();
    const release = vi.fn(async () => {});
    mocks.speak.mockImplementation(async () => ({
      outputFormat: 'pcm', release,
      audioStream: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
    }));
    engine = createAgentVoiceEngine({
      claim: {
        sessionId: 'call', request: { purpose: 'conversation', engine: 'agent', sessionKey: 'chat' },
        config: { voice: { realtime: { bargeIn } } }, tts: { config: {} },
        stt: { model: 'test', route: { provider: 'test' }, plugin: { openAudioStream: async (request: { onEvent: typeof emit }) => {
          emit = request.onEvent;
          return { abort: vi.fn(), appendAudio: vi.fn() };
        } } },
      } as never,
      runtime: { runAgent, recordInterruption: async () => {} } as never,
      signal: new AbortController().signal, send, sendAudio, onClose: async () => {},
    });
    await engine.start();
    return { send, sendAudio, release, emit, currentEmit: () => emit, final: (id: string) => emit({ type: 'transcript_final', utteranceId: id, revision: 1, text: id }) };
  }

  it('serializes the next turn behind cancelled Agent cleanup and suppresses stale completion', async () => {
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    cleanups.push(() => release());
    const calls: string[] = [];
    const test = await setup(async function* (text, _key, signal) {
      calls.push(text);
      if (text === 'first') {
        try {
          yield { type: 'assistant_delta', payload: { delta: 'Hello!' } };
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        } finally { await cleanup; }
      } else yield { type: 'assistant_delta', payload: { delta: 'Next.' } };
    });
    test.final('first');
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce());
    const firstId = test.send.mock.calls.find(([type]) => type === 'response.created')![1].responseId;
    test.emit({ type: 'speech_started', utteranceId: 'second' });
    test.final('second');
    expect(engine.cancel(firstId, 'client_cancelled')).toBe(false);
    expect(calls).toEqual(['first']);
    release();
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']));
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.done', expect.anything()));
    expect(test.send.mock.calls.filter(([type, payload]) => type === 'response.text.done' && payload.responseId === firstId)).toEqual([]);
    expect(test.send.mock.calls.filter(([type]) => type === 'response.cancelled')).toHaveLength(1);
    expect(test.send.mock.calls.filter(([type]) => type === 'session.error')).toEqual([]);
  });

  it('manual stop discards queued and unfinished speech while allowing a fresh utterance', async () => {
    const calls: string[] = [];
    const test = await setup(async function* (text, _key, signal) {
      calls.push(text);
      yield { type: 'assistant_delta', payload: { delta: 'Hello!' } };
      if (text === 'first') await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    }, false);
    test.final('first');
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce());
    const firstId = test.send.mock.calls.find(([type]) => type === 'response.created')![1].responseId;
    for (let index = 0; index < 7; index++) test.final(`queued-${index}`);
    test.emit({ type: 'speech_started', utteranceId: 'unfinished' });
    test.emit({ type: 'transcript_delta', utteranceId: 'unfinished', revision: 1, text: 'Partial' });
    expect(calls).toEqual(['first']);
    expect(engine.cancel(firstId, 'client_cancelled')).toBe(true);
    test.emit({ type: 'transcript_final', utteranceId: 'unfinished', revision: 2, text: 'Late final' });
    await vi.waitFor(() => expect(test.currentEmit()).not.toBe(test.emit));
    test.currentEmit()({ type: 'speech_started', utteranceId: 'fresh' });
    test.final('fresh');
    await vi.waitFor(() => expect(calls).toContain('fresh'));
    expect(calls).toEqual(['first', 'fresh']);
    expect(test.send.mock.calls.filter(([type, payload]) => type === 'input.transcript.final' && payload.utteranceId === 'unfinished')).toEqual([]);
    expect(test.send.mock.calls.filter(([type]) => type === 'response.created')).toHaveLength(2);
  });

  it('mute invalidates old transcription callbacks without cancelling the current reply', async () => {
    const calls: string[] = [];
    const test = await setup(async function* (text, _key, signal) {
      calls.push(text);
      yield { type: 'assistant_delta', payload: { delta: 'Hello!' } };
      if (text === 'first') await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    }, false);
    test.final('first');
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce());
    const oldEmit = test.currentEmit();
    await engine.setInputMuted(true);
    oldEmit({ type: 'transcript_final', utteranceId: 'late', revision: 1, text: 'late' });
    expect(test.send.mock.calls.some(([type]) => type === 'response.cancelled')).toBe(false);
    await engine.setInputMuted(false);
    oldEmit({ type: 'transcript_final', utteranceId: 'later', revision: 1, text: 'later' });
    expect(calls).toEqual(['first']);
    const firstId = test.send.mock.calls.find(([type]) => type === 'response.created')![1].responseId;
    engine.cancel(firstId, 'client_cancelled');
    await Promise.resolve();
    test.currentEmit()({ type: 'transcript_final', utteranceId: 'fresh', revision: 1, text: 'fresh' });
    await vi.waitFor(() => expect(calls).toEqual(['first', 'fresh']));
  });

  it('keeps clarification pending during ambient speech and exposes tool activity', async () => {
    let resume!: () => void;
    const waiting = new Promise<void>((resolve) => { resume = resolve; });
    cleanups.push(() => resume());
    const calls: string[] = [];
    const test = await setup(async function* (text) {
      calls.push(text);
      yield { type: 'tool_start', payload: { toolCallId: 'tool-1', toolName: 'clarify' } };
      yield { type: 'clarify_request', payload: { requestId: 'request-1', question: 'Choose a route', choices: ['A', 'B'] } };
      await waiting;
      yield { type: 'tool_end', payload: { toolCallId: 'tool-1', toolName: 'clarify', status: 'success' } };
    });
    test.final('first');
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.clarification', expect.objectContaining({ requestId: 'request-1' })));
    test.emit({ type: 'speech_started', utteranceId: 'ambient' });
    test.final('ambient');
    expect(test.send.mock.calls.some(([type]) => type === 'response.cancelled')).toBe(false);
    expect(calls).toEqual(['first']);
    resume();
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.activity', expect.objectContaining({ toolCallId: 'tool-1', status: 'completed' })));
    expect(calls).toEqual(['first']);
  });

  it('does not release a closed call until in-flight TTS cleanup finishes', async () => {
    const test = await setup(async function* () { yield { type: 'assistant_delta', payload: { delta: 'Hello!' } }; });
    let resolve!: (value: unknown) => void;
    mocks.speak.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    test.final('first');
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce());
    let closed = false;
    const closing = Promise.resolve(engine.close()).then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    resolve({ outputFormat: 'pcm', release: test.release, audioStream: new ReadableStream() });
    await closing;
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.sendAudio).not.toHaveBeenCalled();
    expect(test.send.mock.calls.filter(([type]) => type === 'response.done' || type === 'session.error')).toEqual([]);
  });
});
