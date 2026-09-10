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
        config: { voice: { realtime: { bargeIn } } }, silenceDurationMs: 1200, tts: { config: {} },
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

  it('does not cancel an audible response for ambient VAD without recognized speech', async () => {
    const test = await setup(async function* () {
      yield { type: 'assistant_delta', payload: { delta: 'Hello.' } };
    });
    mocks.speak.mockImplementationOnce(async () => ({
      outputFormat: 'pcm', release: test.release,
      audioStream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 0])); controller.close(); } }),
    }));
    test.final('first');
    await vi.waitFor(() => expect(test.sendAudio).toHaveBeenCalled());
    test.emit({ type: 'speech_started', utteranceId: 'ambient' });
    test.emit({ type: 'speech_stopped', utteranceId: 'ambient' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(test.send.mock.calls.filter(([type]) => type === 'response.cancelled')).toEqual([]);
  });

  it('does not transcribe or cancel assistant playback echoed by the speaker', async () => {
    const runAgent = vi.fn(async function* () {
      yield { type: 'assistant_delta' as const, payload: { delta: '今天天气怎么样？答案是晴天。' } };
    });
    const test = await setup(runAgent);
    mocks.speak.mockImplementationOnce(async () => ({
      outputFormat: 'pcm', release: test.release,
      audioStream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 0])); controller.close(); } }),
    }));
    test.final('first');
    await vi.waitFor(() => expect(test.sendAudio).toHaveBeenCalled());
    test.emit({ type: 'speech_started', utteranceId: 'echo' });
    test.emit({ type: 'transcript_final', utteranceId: 'echo', revision: 1, text: '今天天气怎么样' });

    expect(test.send.mock.calls.filter(([type, payload]) => type === 'input.transcript.final' && payload.utteranceId === 'echo')).toEqual([]);
    expect(test.send.mock.calls.filter(([type]) => type === 'response.cancelled')).toEqual([]);
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('flushes an unpunctuated acknowledgement as soon as a tool starts', async () => {
    let releaseTool!: () => void;
    const toolRunning = new Promise<void>((resolve) => { releaseTool = resolve; });
    cleanups.push(() => releaseTool());
    const test = await setup(async function* () {
      yield { type: 'assistant_delta', payload: { delta: '我先帮你查一下' } };
      yield { type: 'tool_start', payload: { toolCallId: 'tool-1', toolName: 'search' } };
      await toolRunning;
      yield { type: 'tool_end', payload: { toolCallId: 'tool-1', toolName: 'search', status: 'success' } };
    });

    test.final('first');
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledWith('我先帮你查一下', expect.anything(), expect.anything()));
    expect(test.send).toHaveBeenCalledWith('response.activity', expect.objectContaining({ status: 'running' }));
    releaseTool();
  });

  it('prefetches the next TTS segment before the current stream finishes', async () => {
    let finishFirst: (() => void) | undefined;
    cleanups.push(() => finishFirst?.());
    const test = await setup(async function* () {
      yield { type: 'assistant_delta', payload: { delta: 'This first sentence is long enough to start speaking now!' } };
      yield { type: 'assistant_delta', payload: { delta: ' The second sentence is also long enough to synthesize early!' } };
    });
    mocks.speak.mockImplementationOnce(async () => ({
      outputFormat: 'pcm', release: test.release,
      audioStream: new ReadableStream<Uint8Array>({ start(controller) { finishFirst = () => controller.close(); } }),
    })).mockImplementationOnce(async () => ({
      outputFormat: 'pcm', release: test.release,
      audioStream: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
    }));

    test.final('first');
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    expect(test.send.mock.calls.some(([type]) => type === 'response.done')).toBe(false);
    const finish = finishFirst;
    finishFirst = undefined;
    finish?.();
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.done', expect.anything()));
  });

  it('cancels a thinking response only after barge-in transcription is final', async () => {
    let responseSignal!: AbortSignal;
    const test = await setup(async function* (_text, _key, signal) {
      responseSignal = signal;
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    test.final('first');
    await vi.waitFor(() => expect(responseSignal).toBeDefined());
    test.emit({ type: 'speech_started', utteranceId: 'second' });
    expect(responseSignal.aborted).toBe(false);
    test.emit({ type: 'transcript_delta', utteranceId: 'second', revision: 1, text: 'Wait' });
    expect(responseSignal.aborted).toBe(false);
    test.emit({ type: 'speech_stopped', utteranceId: 'second' });
    test.emit({ type: 'transcript_final', utteranceId: 'second', revision: 2, text: 'Wait' });
    expect(responseSignal.aborted).toBe(true);
    expect(test.send.mock.calls.filter(([type]) => type === 'response.cancelled')).toHaveLength(1);
  });

  it('submits a single combined turn after a slow speaker finishes', async () => {
    const runAgent = vi.fn(async function* () { yield { type: 'assistant_delta' as const, payload: { delta: '好的。' } }; });
    const test = await setup(runAgent);
    test.emit({ type: 'speech_started', utteranceId: 'first' });
    test.emit({ type: 'transcript_final', utteranceId: 'first', revision: 1, text: '帮我查一下。' });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(runAgent).not.toHaveBeenCalled();
    test.emit({ type: 'speech_started', utteranceId: 'second' });
    test.emit({ type: 'transcript_final', utteranceId: 'second', revision: 1, text: '明天下午去上海的高铁。' });
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledOnce());
    expect(runAgent).toHaveBeenCalledWith('帮我查一下。 明天下午去上海的高铁。', 'chat', expect.any(AbortSignal));
  });

  it('does not launch a settled queued fragment while the user resumes speaking', async () => {
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    cleanups.push(() => release());
    const calls: string[] = [];
    const test = await setup(async function* (text, _key, signal) {
      calls.push(text);
      if (text === 'first') {
        yield { type: 'assistant_delta', payload: { delta: 'Hello!' } };
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        await cleanup;
      }
    });
    test.final('first');
    await vi.waitFor(() => expect(calls).toEqual(['first']));
    test.emit({ type: 'speech_started', utteranceId: 'second' });
    test.emit({ type: 'transcript_final', utteranceId: 'second', revision: 1, text: '明天' });
    await new Promise((resolve) => setTimeout(resolve, 450));
    test.emit({ type: 'speech_started', utteranceId: 'third' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toEqual(['first']);
    test.emit({ type: 'transcript_final', utteranceId: 'third', revision: 1, text: '去上海' });
    await vi.waitFor(() => expect(calls).toEqual(['first', '明天 去上海']));
  });

  it('does not answer an unfinished turn after mute or close', async () => {
    const runAgent = vi.fn(async function* () {});
    const test = await setup(runAgent);
    test.emit({ type: 'transcript_final', utteranceId: 'first', revision: 1, text: '因为' });
    await engine.setInputMuted(true);
    await engine.setInputMuted(false);
    await new Promise((resolve) => setTimeout(resolve, 1900));
    expect(runAgent).not.toHaveBeenCalled();
    test.currentEmit()({ type: 'transcript_final', utteranceId: 'second', revision: 1, text: '因为' });
    await engine.close();
    await new Promise((resolve) => setTimeout(resolve, 1900));
    expect(runAgent).not.toHaveBeenCalled();
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
