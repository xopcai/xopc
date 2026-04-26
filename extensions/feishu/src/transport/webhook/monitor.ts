import crypto from 'node:crypto';
import * as http from 'node:http';

import lark from '@larksuiteoapi/node-sdk';

import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelSecurityContext } from '@xopcai/xopc/channels/plugin-types.js';
import { generateSessionKey } from '@xopcai/xopc/chat-commands/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import type { ResolvedFeishuAccount } from '../../state/accounts.js';
import { createFeishuDedupe } from '../reliability/dedupe.js';
import { stripFeishuMentions } from '../text/mentions.js';
import { recordFeishuMessageBinding } from '../../state/message-bindings.js';
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
  bus: MessageBus;
  abortSignal: AbortSignal;
  security: {
    checkAccess: (ctx: ChannelSecurityContext) => { allowed: boolean; reason?: string } | undefined;
  };
}

export function createFeishuWebhookMonitor(deps: FeishuWebhookMonitorDeps) {
  const { account, bus, abortSignal, security } = deps;
  const dedupe = createFeishuDedupe();

  const encryptKey = (account.encryptKey ?? '').trim();
  const verificationToken = (account.verificationToken ?? '').trim();
  if (!encryptKey) throw new Error('Feishu webhook mode requires encryptKey');
  if (!verificationToken) throw new Error('Feishu webhook mode requires verificationToken');

  const host = (account.webhookHost ?? '127.0.0.1').trim() || '127.0.0.1';
  const port = account.webhookPort ?? 3000;
  const path = (account.webhookPath ?? '/feishu/events').trim() || '/feishu/events';
  const l = lark as any;
  const sdkLogger = createFeishuLarkSdkPinoLogger(account.accountId);

  async function handleMessageReceive(event: any): Promise<void> {
    const msg = event?.event?.message ?? event?.message ?? event?.data?.message;
    const sender = event?.event?.sender ?? event?.sender ?? event?.data?.sender;
    const chatId = msg?.chat_id ?? msg?.chatId ?? '';
    const messageId = msg?.message_id ?? msg?.messageId ?? '';
    const chatType = msg?.chat_type ?? msg?.chatType ?? '';

    const senderId =
      sender?.sender_id?.open_id ??
      sender?.sender_id?.user_id ??
      sender?.open_id ??
      sender?.user_id ??
      '';
    const senderName = sender?.sender_id?.name ?? sender?.sender_name ?? undefined;

    if (!chatId || !messageId || !senderId) return;
    if (!dedupe.claim(messageId)) return;

    const isGroup = chatType === 'group' || chatType === 'chat';
    const textRaw =
      msg?.content && typeof msg.content === 'string'
        ? safeJsonText(msg.content)
        : safeJsonText(msg?.body?.content);
    const normalizedText = stripFeishuMentions(textRaw ?? '').trim();
    if (!normalizedText) return;

    const threadId = msg?.thread_id ?? msg?.threadId ?? undefined;
    const sessionKey = generateSessionKey({
      source: 'feishu',
      chatId,
      senderId,
      isGroup,
      threadId: typeof threadId === 'string' && threadId.trim() ? threadId : undefined,
      accountId: account.accountId,
    });

    recordFeishuMessageBinding({
      messageId,
      sessionKey,
      accountId: account.accountId,
      chatId,
      senderId,
      isGroup,
      threadId: typeof threadId === 'string' && threadId.trim() ? threadId : undefined,
    });

    const access = security.checkAccess({
      accountId: account.accountId,
      chatId,
      senderId,
      senderName,
      isGroup,
      threadId,
    });
    if (access && !access.allowed) return;

    await bus.publishInbound({
      channel: 'feishu',
      sender_id: senderId,
      chat_id: chatId,
      content: normalizedText,
      metadata: {
        sessionKey,
        accountId: account.accountId,
        messageId,
        threadId,
        isGroup,
        feishuEventType: 'im.message.receive_v1',
        raw: event,
      },
    });
  }

  const dispatcher = new l.EventDispatcher({
    verifyChallenge: false,
    encryptKey,
    verificationToken,
    logger: sdkLogger,
    loggerLevel: l.LoggerLevel.info,
  } as any);
  dispatcher.register({
    'im.message.receive_v1': async (data: any) => await handleMessageReceive(data),
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

    const { isChallenge, challenge } = (lark as any).generateChallenge(payload, { encryptKey });
    if (isChallenge) return json(res, 200, challenge);

    const envelope = Object.assign(Object.create({ headers: req.headers }), payload);
    const out = await dispatcher.invoke(envelope, { needCheck: false });
    if (!res.headersSent) return json(res, 200, out);
  }

  async function run(): Promise<void> {
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

    log.info({ accountId: account.accountId, host, port, path }, 'Feishu webhook server listening');

    await new Promise<void>((resolve) => {
      if (abortSignal.aborted) {
        server.close();
        return resolve();
      }
      abortSignal.addEventListener(
        'abort',
        () => {
          server.close();
          resolve();
        },
        { once: true },
      );
    });
  }

  return { run };
}

function safeJsonText(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    const t =
      typeof parsed?.text === 'string'
        ? parsed.text
        : typeof parsed?.content === 'string'
          ? parsed.content
          : typeof parsed?.title === 'string'
            ? parsed.title
            : undefined;
    return typeof t === 'string' ? t : raw;
  } catch {
    return raw;
  }
}

