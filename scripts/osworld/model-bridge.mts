/** JSONL model boundary for disposable OSWorld guests; never executes desktop input. */
import '../../src/infra/http-proxy-env.js';

import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';

import { COMPUTER_FRAME_MAX_BYTES, COMPUTER_FRAME_MAX_PIXELS } from '@xopcai/computer-control-contract';
import { createComputerModelAdapter, predictComputerStep } from '../../src/computer/model-adapter.js';
import { computerDiagnostic } from '../../src/computer/errors.js';
import { computerModelProfile } from '../../src/computer/model-policy.js';
import { getApiKey, resolveModel } from '../../src/providers/index.js';

const [modelRef = 'openai/gpt-6.1-sol'] = process.argv.slice(2);
const History = z.object({
  goal: z.string().max(1000), action: z.enum(['click', 'drag', 'typeText', 'pressKeys', 'scroll', 'wait']),
  actionPreview: z.string().max(1000), dispatch: z.literal('completed'), outcome: z.literal('unknown'),
  after: z.string().max(2000), afterStateDigest: z.string().max(100),
}).strict();
const Request = z.discriminatedUnion('op', [
  z.object({ op: z.literal('preflight') }).strict(),
  z.object({ op: z.literal('predict'), goal: z.string().min(1).max(4000), summary: z.string().max(12000),
    width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384),
    screenshotBase64: z.string().min(1).max(Math.ceil(COMPUTER_FRAME_MAX_BYTES / 3) * 4),
    history: z.array(History).max(6),
  }).strict(),
]);

async function connect() {
  const model = resolveModel(modelRef);
  if (!/^gpt-6\.1(?:-|$)/.test(model.id)) throw new Error('OSWORLD_GPT61_REQUIRED');
  const profile = computerModelProfile(model);
  if (profile !== 'structured-tools-v1') throw new Error('OSWORLD_STRUCTURED_PROFILE_REQUIRED');
  const apiKey = await getApiKey(model.provider);
  if (!apiKey) throw new Error('OSWORLD_CREDENTIAL_UNAVAILABLE');
  return { adapter: createComputerModelAdapter({ modelId: model.id, api: model.api, baseUrl: model.baseUrl, apiKey, profile,
    headers: model.headers, maxOutputTokens: 2048 }),
    modelIdentity: createHash('sha256').update(JSON.stringify({ provider: model.provider, id: model.id,
      api: model.api, baseUrl: model.baseUrl, profile })).digest('hex') };
}

let connection: Awaited<ReturnType<typeof connect>> | undefined;
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let pixels: Buffer | undefined;
  let modelRequests = 0;
  try {
    if (line.length > 8 * 1024 * 1024) throw new Error('OSWORLD_REQUEST_LIMIT');
    const request = Request.parse(JSON.parse(line));
    connection ??= await connect();
    if (request.op === 'preflight') {
      process.stdout.write(JSON.stringify({ ok: true, modelRef, modelIdentity: connection.modelIdentity, profile: 'structured-tools-v1' }) + '\n');
      continue;
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(request.screenshotBase64)) throw new Error('OSWORLD_INVALID_IMAGE');
    pixels = Buffer.from(request.screenshotBase64, 'base64');
    if (pixels.byteLength > COMPUTER_FRAME_MAX_BYTES) throw new Error('OSWORLD_REQUEST_LIMIT');
    const image = sharp(pixels, { limitInputPixels: COMPUTER_FRAME_MAX_PIXELS });
    const metadata = await image.metadata();
    if (metadata.width !== request.width || metadata.height !== request.height || metadata.format !== 'png') throw new Error('OSWORLD_INVALID_IMAGE');
    await image.stats();
    const proposal = await predictComputerStep(connection.adapter, {
      goal: request.goal, image: pixels, mimeType: 'image/png', width: request.width, height: request.height,
      summary: request.summary, history: request.history, maxPlanActions: 1, onModelRequest: () => modelRequests++,
    }, () => {}, AbortSignal.timeout(90_000));
    process.stdout.write(JSON.stringify({ ok: true, modelRef, modelIdentity: connection.modelIdentity, proposal, modelRequests }) + '\n');
  } catch (error) {
    // OAuth/provider errors may include sensitive prose. Only emit known diagnostic codes.
    const code = computerDiagnostic(error)?.errorCode
      ?? (error instanceof Error && /^OSWORLD_[A-Z_0-9]+$/.test(error.message) ? error.message : 'OSWORLD_BRIDGE_FAILED');
    process.stdout.write(JSON.stringify({ ok: false, errorCode: code, modelRequests }) + '\n');
    process.exitCode = 1;
    break;
  } finally { pixels?.fill(0); }
}
