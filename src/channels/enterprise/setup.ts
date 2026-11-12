import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { Config } from '../../config/schema.js';
import type { ChannelRuntimeActionAdapter } from '../plugins/types.adapters.js';
import { record, string } from './socket.js';

export type EnterpriseCredentials = { id: string; secret: string };

export type EnterpriseRegistration = {
  qrPayload: string;
  expiresInSec: number;
  intervalMs: number;
  poll: (signal: AbortSignal) => Promise<EnterpriseCredentials | 'expired' | undefined>;
};

export function createEnterpriseSetup(options: {
  channel: string;
  credentialFields: readonly [string, string];
  credentialLabels: readonly [string, string];
  begin: (signal: AbortSignal) => Promise<EnterpriseRegistration>;
  verify: (credentials: EnterpriseCredentials) => Promise<void>;
}): ChannelRuntimeActionAdapter {
  const { channel, credentialFields: [idField, secretField], credentialLabels: [idLabel, secretLabel] } = options;
  type SetupSession = {
    id: string;
    expiresAt: number;
    registration: EnterpriseRegistration;
    originalConfig: unknown;
    controller: AbortController;
    polling?: Promise<EnterpriseCredentials | 'expired' | undefined>;
    nextPollAt: number;
  };
  let session: SetupSession | undefined;
  let starting: AbortController | undefined;

  function complete(cfg: Config, credentials: EnterpriseCredentials): Config {
    const current = record(cfg.channels?.[channel]);
    const sameBot = !current[idField] || current[idField] === credentials.id;
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [channel]: {
          ...(sameBot ? current : {}),
          enabled: true,
          [idField]: credentials.id,
          [secretField]: credentials.secret,
        },
      },
    };
  }

  return {
    async runAction({ actionId, cfg, input, locale, accountId }) {
      const zh = locale?.startsWith('zh') ?? false;
      const copy = (chinese: string, english: string) => zh ? chinese : english;
      const raw = record(input);
      const id = string(raw.conversationId);
      const manual = {
        type: 'form' as const,
        submitAction: 'setup.manual',
        schema: {
          type: 'object',
          required: [idField, secretField],
          properties: {
            [idField]: { type: 'string', title: idLabel },
            [secretField]: { type: 'string', title: secretLabel, format: 'password' },
          },
        },
      };
      if (accountId && accountId !== 'default') return { ok: false, message: 'Only the default account is supported.' };

      if (actionId === 'setup.manual') {
        const credentials = { id: string(raw[idField]), secret: string(raw[secretField]) };
        if (!credentials.id || !credentials.secret) return { ok: true, payload: manual };
        try {
          const current = record(cfg.channels?.[channel]);
          if (current[idField] !== credentials.id || current[secretField] !== credentials.secret || current.enabled !== true) {
            await options.verify(credentials);
          }
        } catch {
          return { ok: false, message: copy('凭据校验失败，请确认机器人配置后重试。', 'Credential validation failed. Check the bot settings and retry.') };
        }
        return {
          ok: true,
          nextConfig: complete(cfg, credentials),
          payload: { type: 'ok', configChanged: true },
          onConfigSaved: () => { session?.controller.abort(); session = undefined; },
        };
      }
      if (actionId === 'setup.start') {
        starting?.abort();
        session?.controller.abort();
        session = undefined;
        const controller = new AbortController();
        starting = controller;
        try {
          const registration = await options.begin(controller.signal);
          if (starting !== controller) return { ok: false, message: 'Setup was replaced.' };
          const expiresAt = Date.now() + registration.expiresInSec * 1000;
          const active: SetupSession = {
            id: randomUUID(), expiresAt, registration, originalConfig: structuredClone(cfg.channels?.[channel]),
            controller, nextPollAt: Date.now() + registration.intervalMs,
          };
          session = active;
          setTimeout(() => {
            if (session === active) {
              active.controller.abort();
              session = undefined;
            }
          }, registration.expiresInSec * 1000).unref();
          return { ok: true, payload: {
            type: 'qr', conversationId: active.id, qrPayload: registration.qrPayload,
            expiresInSec: registration.expiresInSec, pollIntervalMs: registration.intervalMs,
            statusAction: 'setup.status', cancelAction: 'setup.cancel',
          } };
        } catch {
          return { ok: true, payload: {
            ...manual, message: copy('扫码暂不可用，请填写机器人凭据。', 'QR setup is unavailable. Enter the bot credentials.'),
          } };
        } finally {
          if (starting === controller) starting = undefined;
        }
      }
      if (actionId === 'setup.cancel') {
        if (session?.id === id) {
          session.controller.abort();
          session = undefined;
        }
        return { ok: true, payload: { type: 'ok' } };
      }
      if (actionId === 'setup.status') {
        const active = session;
        if (!active || active.id !== id || Date.now() >= active.expiresAt ||
            !isDeepStrictEqual(active.originalConfig, cfg.channels?.[channel])) {
          return { ok: true, payload: { type: 'poll', phase: 'unknown', ok: false,
            message: copy('配置已变更或二维码已过期，请重新连接。', 'Settings changed or the QR code expired. Start setup again.') } };
        }
        if (!active.polling && Date.now() < active.nextPollAt) {
          return { ok: true, payload: { type: 'poll', phase: 'pending' } };
        }
        try {
          active.polling ??= active.registration.poll(active.controller.signal);
          const credentials = await active.polling;
          if (active !== session || active.controller.signal.aborted) {
            return { ok: true, payload: { type: 'poll', phase: 'unknown', ok: false } };
          }
          if (credentials === 'expired') {
            active.controller.abort();
            session = undefined;
            return { ok: true, payload: { type: 'poll', phase: 'done', ok: false,
              message: copy('扫码授权已结束，请重新扫码或手动填写凭据。', 'QR authorization ended. Scan again or enter credentials.') } };
          }
          if (!credentials) {
            active.polling = undefined;
            active.nextPollAt = Date.now() + active.registration.intervalMs;
            return { ok: true, payload: { type: 'poll', phase: 'pending' } };
          }
          return {
            ok: true,
            nextConfig: complete(cfg, credentials),
            payload: { type: 'poll', phase: 'done', ok: true, configChanged: true },
            beforeConfigSaved: () => { if (session !== active) throw new Error('Setup was cancelled.'); },
            onConfigSaved: () => { if (session === active) session = undefined; },
          };
        } catch {
          active.polling = undefined;
          active.nextPollAt = Date.now() + active.registration.intervalMs;
          return { ok: true, payload: { type: 'poll', phase: 'pending' } };
        }
      }
      return { ok: false, message: 'Unsupported channel action.' };
    },
  };
}
