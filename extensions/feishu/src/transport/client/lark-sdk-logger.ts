import { createLogger } from '@xopcai/xopc/utils/logger.js';
import type { Logger } from 'pino';

function normalizeLarkLogArgs(args: any[]): { parts: any[]; err?: Error } {
  const raw: any = args.length === 1 ? args[0] : args;
  if (Array.isArray(raw)) {
    const errIdx = raw.findIndex((x) => x instanceof Error);
    if (errIdx >= 0) {
      const err = raw[errIdx] as Error;
      const parts = raw.filter((_, i) => i !== errIdx);
      return { parts, err };
    }
    return { parts: raw };
  }
  return { parts: [raw] };
}

function stringifyParts(parts: any[]): { text: string; hasLongLines: boolean } {
  const mapped = parts.map((p) => {
    if (typeof p === 'string') return p;
    if (p instanceof Error) return p.message;
    if (p === null || p === undefined) return '';
    try {
      return JSON.stringify(p);
    } catch {
      return String(p);
    }
  });
  const text = mapped.join(' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const hasLongLines = text.includes('\n') || text.length > 240;
  return { text, hasLongLines };
}

function linePreview(text: string, max = 240): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + '…';
}

/**
 * Adapts `@larksuiteoapi/node-sdk`'s `Logger` interface to xopc's pino-based logger.
 *
 * The SDK wraps calls like `this.logger.info('a', 'b')` into `LoggerProxy.info` which forwards a *single* array
 * argument to the underlying logger — which is why the default output looks like: `[info]: [ 'a', 'b' ]`.
 */
export function createFeishuLarkSdkPinoLogger(accountId: string): {
  error: (...msg: any[]) => void;
  warn: (...msg: any[]) => void;
  info: (...msg: any[]) => void;
  debug: (...msg: any[]) => void;
  trace: (...msg: any[]) => void;
} {
  const log: Logger = createLogger('FeishuLarkSDK') as unknown as Logger;

  const write = (level: 'error' | 'warn' | 'info' | 'debug' | 'trace', args: any[]) => {
    const { parts, err } = normalizeLarkLogArgs(args);
    const { text, hasLongLines } = stringifyParts(parts);
    if (!text && !err) return;

    if (err) {
      (log as any)[level](
        { err, accountId, linePreview: text ? linePreview(text) : undefined, component: 'lark-sdk' },
        text || err.message,
      );
      return;
    }

    if (level === 'info' && (text === 'client ready' || /^\[ws\]\s*ws client ready$/.test(text))) {
      // `Client` logs "client ready" and WSClient logs "[ws] ws client ready" — both mean the client stack is up.
      log.info({ accountId, component: 'lark-sdk', lark: 'api+ws' }, 'Lark SDK is ready (HTTP client + websocket)');
      return;
    }
    if (level === 'info' && text === 'event-dispatch is ready') {
      log.info({ accountId, component: 'lark-sdk', lark: 'event-dispatch' }, 'Lark event dispatcher is ready');
      return;
    }
    if (level === 'info' && hasLongLines) {
      log.info(
        { accountId, component: 'lark-sdk', lark: 'event-subscription', linePreview: linePreview(text) },
        'Lark subscription guidance: enable persistent connection mode in Developer Console (self-build + Feishu app)',
      );
      return;
    }

    (log as any)[level]({ accountId, component: 'lark-sdk', linePreview: linePreview(text) }, text);
  };

  return {
    error: (...args) => write('error', args),
    warn: (...args) => write('warn', args),
    info: (...args) => write('info', args),
    debug: (...args) => write('debug', args),
    trace: (...args) => write('trace', args),
  };
}
