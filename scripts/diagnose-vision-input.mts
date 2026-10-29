/** Inspect only synthetic image bytes and model metadata; credentials never enter the report. */
import { resolveModel } from '../src/providers/index.js';
import { completeWithResolvedCredentials } from '../src/providers/model-call.js';
import { registerBundledOAuthFlows } from '../src/providers/register-bundled-oauth-flows.js';
import { configureTracing } from '../src/observability/runtime.js';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const model = resolveModel('xopc-cloud/auto');
console.log(JSON.stringify({ model: { id: model.id, api: model.api, input: model.input,
  baseUrl: model.baseUrl, compat: model.compat } }));
if (process.argv.includes('--live')) {
  if (process.env.XOPC_LIVE_LATENCY !== '1') throw new Error('Explicit live-model opt-in is required');
  registerBundledOAuthFlows();
  await configureTracing({ enabled: false });
}
const argument = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`${name}=`))?.split('=')[1] ?? fallback;
const count = Number(argument('--count', '2'));
const size = Number(argument('--size', '64'));
if (!Number.isSafeInteger(count) || count < 1 || count > 30 || !Number.isSafeInteger(size) || size < 1 || size > 2048) {
  throw new Error('count must be 1..30 and size must be 1..2048');
}
for (let index = 0; index < count; index++) {
  const color = index % 2 === 0 ? '#ff0000' : '#0000ff';
  const data = await sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer();
  const stats = await sharp(data).stats();
  console.log(JSON.stringify({ color, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'),
    channelMeans: stats.channels.map(channel => channel.mean) }));
  if (process.argv.includes('--live')) {
    let wireImages: Array<{ sha256: string; bytes: number; channelMeans: number[] }> = [];
    const response = await completeWithResolvedCredentials(model, {
      messages: [{ role: 'user', content: [{ type: 'text', text: '这张纯色图片是什么颜色？只回复颜色名称。' },
        { type: 'image', data: data.toString('base64'), mimeType: 'image/png' }], timestamp: Date.now() }],
    }, { maxTokens: 64, onPayload: async payload => {
      const body = payload as { messages?: Array<{ content?: unknown }> };
      wireImages = [];
      for (const message of body.messages ?? []) {
        if (!Array.isArray(message.content)) continue;
        for (const block of message.content) {
          if (block.type !== 'image_url') continue;
          const buffer = Buffer.from(String(block.image_url.url).split(',')[1]!, 'base64');
          wireImages.push({ sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length,
            channelMeans: (await sharp(buffer).stats()).channels.map(channel => channel.mean) });
        }
      }
    } }, undefined, { operation: 'agent.answer', trigger: 'user' });
    console.log(JSON.stringify({ index, size, color, wireImages, stopReason: response.stopReason,
      text: response.content.filter(block => block.type === 'text').map(block => block.text).join(''),
      error: response.errorMessage }));
  }
}
