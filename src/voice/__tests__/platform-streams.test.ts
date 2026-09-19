import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import type { StreamingSttEvent } from '../../media-understanding/types.js';
import { openPlatformStt, openPlatformTts } from '../platform-streams.js';

const servers: WebSocketServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function server() {
  const server = new WebSocketServer({ port: 0 }); servers.push(server); await once(server, 'listening');
  return { server, url: `ws://127.0.0.1:${(server.address() as {port:number}).port}` };
}
describe('platform voice protocol', () => {
  it('replaces partial transcripts by item and waits for finalization', async () => {
    const {server:s, url} = await server();
    const events: StreamingSttEvent[] = [];
    s.on('connection', socket => socket.on('message', (raw, binary) => {
      if (binary) {
        socket.send(JSON.stringify({type:'transcript.partial', item_id:'one', text:'你好'}));
        socket.send(JSON.stringify({type:'transcript.partial', item_id:'one', text:'你好世界'})); return;
      }
      const event = JSON.parse(raw.toString());
      if (event.type === 'session.update') socket.send(JSON.stringify({type:'session.updated', session:{input_sample_rate:16000}}));
      if (event.type === 'session.finish') {
        socket.send(JSON.stringify({type:'transcript.final', item_id:'one', text:'你好世界。'}));
        socket.send(JSON.stringify({type:'session.finished'}));
      }
    }));
    const session = await openPlatformStt({model:'new-vendor-asr', baseUrl:url, apiKey:'test', inputFormat:{encoding:'pcm_s16le',sampleRate:16000,channels:1}, turnDetection:{mode:'server_vad',silenceDurationMs:700}, timeoutMs:1000, signal:new AbortController().signal, onEvent:event => events.push(event)});
    session.appendAudio(new Uint8Array(640)); await session.commit();
    expect(events.filter(event => event.type === 'transcript_delta').map(event => event.text)).toEqual(['你好', '你好世界']);
    expect(events.filter(event => event.type === 'transcript_final')).toEqual([{type:'transcript_final',utteranceId:'one',revision:3,text:'你好世界。'}]);
    expect(events.at(-1)).toEqual({type:'usage',inputAudioMs:20});
  });
  it('streams PCM and completes without any vendor event envelopes', async () => {
    const {server:s, url} = await server(); const received: unknown[] = [];
    s.on('connection', socket => socket.on('message', raw => {
      const event = JSON.parse(raw.toString()); received.push(event);
      if (event.type === 'session.update') socket.send(JSON.stringify({type:'session.updated', session:{output_sample_rate:24000}}));
      if (event.type === 'input_text_buffer.commit') socket.send(JSON.stringify({type:'response.done'}));
      if (event.type === 'session.finish') {
        socket.send(JSON.stringify({type:'response.audio.delta', delta:Buffer.alloc(960,1).toString('base64')}));
        socket.send(JSON.stringify({type:'session.finished'}));
      }
    }));
    const result = await openPlatformTts({baseUrl:url,apiKey:'test',voice:'vendor-independent',text:'你好',signal:new AbortController().signal,timeoutMs:1000});
    const reader = result.audioStream.getReader();
    expect((await reader.read()).value?.length).toBe(960); expect((await reader.read()).done).toBe(true);
    expect(received).toEqual([{type:'session.update',session:{voice:'vendor-independent'}},{type:'input_text_buffer.append',text:'你好'},{type:'input_text_buffer.commit'},{type:'session.finish'}]);
    await result.release?.();
  });
  it('pauses platform audio while a slow consumer drains the bounded stream', async () => {
    const {server:s, url} = await server();
    const chunk = Buffer.alloc(16 * 1024, 1);
    const chunkCount = 80;
    s.on('connection', socket => socket.on('message', raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === 'session.update') socket.send(JSON.stringify({type:'session.updated', session:{output_sample_rate:24000}}));
      if (event.type === 'input_text_buffer.commit') socket.send(JSON.stringify({type:'response.done'}));
      if (event.type === 'session.finish') {
        for (let index = 0; index < chunkCount; index++) {
          socket.send(JSON.stringify({type:'response.audio.delta', delta:chunk.toString('base64')}));
        }
        socket.send(JSON.stringify({type:'session.finished'}));
      }
    }));
    const result = await openPlatformTts({baseUrl:url,apiKey:'test',voice:'a',text:'hello',signal:new AbortController().signal,timeoutMs:2000});
    await new Promise(resolve => setTimeout(resolve, 50));
    const reader = result.audioStream.getReader();
    let bytes = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
    }
    expect(bytes).toBe(chunk.byteLength * chunkCount);
    await result.release?.();
  });
  it('fails a closed synthesis stream instead of claiming completion', async () => {
    const {server:s,url} = await server();
    s.on('connection', socket => socket.on('message', raw => {
      if (JSON.parse(raw.toString()).type === 'session.update') socket.send(JSON.stringify({type:'session.updated',session:{output_sample_rate:24000}})); else socket.close();
    }));
    const result = await openPlatformTts({baseUrl:url,apiKey:'test',voice:'a',text:'hello',signal:new AbortController().signal,timeoutMs:1000});
    await expect(result.audioStream.getReader().read()).rejects.toThrow('disconnected');
  });
});
