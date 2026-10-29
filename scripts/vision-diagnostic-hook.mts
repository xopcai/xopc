/** Temporary preload: capture only synthetic probe image metadata, never headers or raw payloads. */
import { appendFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

const marker = '这是临时性能测试，请直接回答，不使用工具、不安排任务、不保存记忆。';
const output = process.env.XOPC_VISION_DIAGNOSTIC_PATH;
if (!output) throw new Error('XOPC_VISION_DIAGNOSTIC_PATH is required');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let capturedId: string | undefined;
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === 'router.xopc.ai' && /\/(chat\/completions|responses)$/.test(url.pathname)) {
    const body = typeof init?.body === 'string' ? init.body
      : input instanceof Request ? await input.clone().text() : undefined;
    if (body && body.length < 2_000_000 && body.includes(marker)) {
      const payload = JSON.parse(body);
      const images: Array<{ hash: string; bytes: number; means: number[] }> = [];
      for (const message of payload.messages ?? payload.input ?? []) {
        if (!Array.isArray(message.content)) continue;
        for (const block of message.content) {
          if (!['image_url', 'input_image'].includes(block.type)) continue;
          const source = typeof block.image_url === 'string' ? block.image_url : block.image_url.url;
          const data = Buffer.from(source.split(',')[1], 'base64');
          images.push({ hash: createHash('sha256').update(data).digest('hex'), bytes: data.length,
            means: (await sharp(data).stats()).channels.map(channel => channel.mean) });
        }
      }
      capturedId = randomUUID();
      appendFileSync(output, JSON.stringify({ type: 'request', id: capturedId, at: Date.now(), path: url.pathname, model: payload.model,
        messages: (payload.messages ?? payload.input ?? []).map((message: any) => ({ role: message.role,
          contentTypes: Array.isArray(message.content) ? message.content.map((block: any) => block.type) : ['text'] })), images }) + '\n', { mode: 0o600 });
    }
  }
  const response = await originalFetch(input, init);
  if (capturedId) {
    const id = capturedId;
    void response.clone().text().then(body => {
      let text = '';
      const models = new Set<string>();
      for (const line of body.split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (typeof event.model === 'string') models.add(event.model.slice(0, 120));
          text += event.choices?.[0]?.delta?.content ?? (event.type === 'response.output_text.delta' ? event.delta : '');
        } catch { /* Non-JSON SSE lines carry no answer text. */ }
      }
      appendFileSync(output, JSON.stringify({ type: 'response', id, at: Date.now(),
        status: response.status, models: [...models], text: text.slice(0, 120) }) + '\n');
    }).catch(() => {});
  }
  return response;
};
