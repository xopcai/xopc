import { expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { createOmniVoiceEngine } from '../omniEngine.js';
import type { VoiceEngine } from '../engine.js';

const enabled = process.env.XOPC_LIVE_OMNI === '1' && Boolean(process.env.DASHSCOPE_API_KEY);
const url = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-omni-flash-realtime';

/** Opt-in paid vendor test. Synthetic speech stays in memory; no microphone or transcript is logged. */
it.skipIf(!enabled)('round-trips synthetic speech through the native Qwen engine', async () => {
  const fixture = await new Promise<Buffer>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` } });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Speech fixture timed out')); }, 15000);
    const finish = (error?: Error) => { clearTimeout(timer); socket.close(); if (error) reject(error); else resolve(Buffer.concat(chunks)); };
    socket.on('error', () => finish(new Error('Speech fixture connection failed')));
    socket.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === 'session.created') socket.send(JSON.stringify({ type: 'session.update', session: { modalities: ['text', 'audio'], voice: 'Cherry', output_audio_format: 'pcm', turn_detection: null, instructions: 'Say only: Hello, how are you today?' } }));
      if (event.type === 'session.updated') socket.send(JSON.stringify({ type: 'response.create' }));
      if (event.type === 'response.audio.delta') chunks.push(Buffer.from(event.delta, 'base64'));
      if (event.type === 'response.done') finish(event.response.status === 'completed' ? undefined : new Error('Speech fixture generation failed'));
      if (event.type === 'error') finish(new Error('Speech fixture rejected'));
    });
  });
  expect(fixture.length).toBeGreaterThan(0);
  const pcm = Buffer.alloc(Math.floor(fixture.length / 3) * 2 + 32000);
  for (let i = 0; i < Math.floor(fixture.length / 3); i++) pcm.writeInt16LE(fixture.readInt16LE(Math.floor(i * 1.5) * 2), i * 2);
  const events: string[] = [];
  const record = vi.fn(async () => {});
  let outputBytes = 0;
  let engine!: VoiceEngine;
  engine = createOmniVoiceEngine({
    callId: 'live-omni-test',
    route: { url, apiKey: process.env.DASHSCOPE_API_KEY!, voice: 'Cherry', instructions: 'Reply briefly in one sentence. Do not use tools.', route: { provider: 'alibaba', model: 'qwen3-omni-flash-realtime', managed: false } },
    silenceDurationMs: 700, bargeIn: true,
    send: (type) => { events.push(type); },
    sendAudio: (responseId, audio) => { outputBytes += audio.length; engine.acknowledge(responseId, outputBytes); },
    record, onClose: async () => { engine.close(); },
  });
  try {
    await engine.start();
    for (let offset = 0; offset < pcm.length; offset += 640) {
      engine.appendAudio(pcm.subarray(offset, offset + 640));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await vi.waitFor(() => { expect(events).not.toContain('session.error'); expect(events).toContain('response.done'); }, { timeout: 15000 });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(outputBytes).toBeGreaterThan(0);
  } finally { engine.close(); }
}, 45000);
