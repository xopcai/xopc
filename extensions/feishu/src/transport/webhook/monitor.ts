import crypto from 'node:crypto';
import * as http from 'node:http';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelSecurityContext } from '@xopcai/xopc/channels/plugin-types.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import type { ResolvedFeishuAccount } from '../../state/accounts.js';
import { createFeishuMessageIngress } from '../reliability/message-ingress.js';
import type { FeishuInboundWork } from '../reliability/inbound-pipeline.js';
import { loadFeishuLarkSdk } from '../client/lark-sdk.js';
import { createFeishuLarkSdkPinoLogger } from '../client/lark-sdk-logger.js';

const log = createLogger('FeishuWebhook');

const MAX_BODY_BYTES = 256 * 1024;
const BODY_TIMEOUT_MS = 2_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_MAX_KEYS = 4096;

type RateKeyState = { windowStart: number; count: number };
const rateState = new Map<string, RateKeyState>();

function pruneRateState(now: number) {
  for (const [k, v] of rateState.entries()) {
    if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateState.delete(k);
    }
  }
  if (rateState.size <= RATE_LIMIT_MAX_KEYS) return;
  const over = rateState.size - RATE_LIMIT_MAX_KEYS;
  let i = 0;
  for (const k of rateState.keys()) {
    rateState.delete(k);
    i++;
    if (i >= over) break;
  }
}

function isRateLimited(key: string, now: number): boolean {
  pruneRateState(now);
  const cur = rateState.get(key);
  if (!cur || now - cur.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateState.set(key, { windowStart: now, count: 1 });
    return false;
  }
  cur.count += 1;
  return cur.count > RATE_LIMIT_MAX;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function signatureValid(headers: http.IncomingHttpHeaders, rawBody: string, encryptKey: string): boolean {
  const timestampHeader = headers['x-lark-request-timestamp'];
  const nonceHeader = headers['x-lark-request-nonce'];
  const signatureHeader = headers['x-lark-signature'];
  const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;
  const nonce = Array.isArray(nonceHeader) ? nonceHeader[0] : nonceHeader;
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!timestamp || !nonce || !signature) return false;
  if (typeof signature !== 'string' || signature.length < 32) return false;
  const computed = crypto.createHash('sha256').update(timestamp + nonce + encryptKey + rawBody).digest('hex');
  return safeEqual(computed, signature);
}

function readBody(
  req: http.IncomingMessage,
): Promise<{ ok: true; body: string } | { ok: false; status: number; msg: string }> {
  return new Promise((resolve) => {
    let done = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, status: 408, msg: 'Request body timeout' });
      req.destroy();
    }, BODY_TIMEOUT_MS);

    req.on('data', (chunk: Buffer) => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        done = true;
        clearTimeout(t);
        resolve({ ok: false, status: 413, msg: 'Payload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({ ok: true, body: Buffer.concat(chunks).toString('utf8') });
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({ ok: false, status: 400, msg: 'Bad Request' });
    });
  });
}

function json(res: http.ServerResponse, status: number, obj: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function text(res: http.ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

export interface FeishuWebhookMonitorDeps {
  account: ResolvedFeishuAccount;
  config: Config;
  enqueueInbound: (work: FeishuInboundWork) => Promise<void>;
  inboundDebounceDefaultMs: number;
  abortSignal: AbortSignal;
  onState?: (state: 'connecting' | 'online' | 'error') => void;
  security: {
    checkAccess: (ctx: ChannelSecurityContext) => { allowed: boolean; reason?: string } | undefined;
  };
}

export function createFeishuWebhookMonitor(deps: FeishuWebhookMonitorDeps) {
  const { account, abortSignal } = deps;
  const ingress = createFeishuMessageIngress(deps);

  const encryptKey = (account.encryptKey ?? '').trim();
  const verificationToken = (account.verificationToken ?? '').trim();
  if (!encryptKey) throw new Error('Feishu webhook mode requires encryptKey');
  if (!verificationToken) throw new Error('Feishu webhook mode requires verificationToken');

  const host = (account.webhookHost ?? '127.0.0.1').trim() || '127.0.0.1';
  const port = account.webhookPort ?? 3000;
  const path = (account.webhookPath ?? '/feishu/events').trim() || '/feishu/events';
  const l = loadFeishuLarkSdk() as any;
  const sdkLogger = createFeishuLarkSdkPinoLogger(account.accountId);

  const dispatcher = new l.EventDispatcher({
    verifyChallenge: false,
    encryptKey,
    verificationToken,
    logger: sdkLogger,
    loggerLevel: l.LoggerLevel.info,
  } as any);
  dispatcher.register({
    'im.message.receive_v1': async (data: unknown) => ingress.accept(data),
  });

  const server = http.createServer();

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'POST') return text(res, 405, 'Method Not Allowed');
    if ((req.url ?? '').split('?')[0] !== path) return text(res, 404, 'Not Found');

    const now = Date.now();
    const rateKey = `${account.accountId}:${path}:${req.socket.remoteAddress ?? 'unknown'}`;
    if (isRateLimited(rateKey, now)) return text(res, 429, 'Too Many Requests');

    const contentType = String(req.headers['content-type'] ?? '');
    if (!contentType.toLowerCase().includes('application/json')) return text(res, 415, 'Unsupported Media Type');

    const body = await readBody(req);
    if (body.ok === false) return text(res, body.status, body.msg);

    if (!signatureValid(req.headers, body.body, encryptKey)) return text(res, 401, 'Invalid signature');

    let payload: any;
    try {
      payload = JSON.parse(body.body);
    } catch {
      return text(res, 400, 'Invalid JSON');
    }

    const token = payload?.token ?? payload?.header?.token ?? payload?.event?.token;
    if (typeof token === 'string' && token.trim() && token.trim() !== verificationToken) {
      return text(res, 401, 'Invalid verification token');
    }

    const { isChallenge, challenge } = l.generateChallenge(payload, { encryptKey });
    if (isChallenge) return json(res, 200, challenge);

    const envelope = Object.assign(Object.create({ headers: req.headers }), payload);
    const out = await dispatcher.invoke(envelope, { needCheck: false });
    if (!res.headersSent) return json(res, 200, out);
  }

  async function run(): Promise<void> {
    ingress.start();
    await new Promise<void>((resolve, reject) => {
      server.on('request', (req, res) => {
        void handleRequest(req, res).catch((err) => {
          log.error({ err, accountId: account.accountId }, 'Feishu webhook handler error');
          if (!res.headersSent) text(res, 500, 'Internal Server Error');
        });
      });
      server.on('error', (err) => reject(err));
      server.listen(port, host, () => resolve());
    });

    deps.onState?.('online');
    log.info({ accountId: account.accountId, host, port, path }, 'Feishu webhook server listening');

    await new Promise<void>((resolve) => {
      if (abortSignal.aborted) {
        server.close(() => resolve());
        return;
      }
      abortSignal.addEventListener(
        'abort',
        () => {
          server.close(() => resolve());
        },
        { once: true },
      );
    });
    await ingress.settled();
  }

  return { run };
}
