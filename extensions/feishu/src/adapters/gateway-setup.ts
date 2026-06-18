import { loadConfig, saveConfig } from '@xopcai/xopc/config/loader.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type {
  ChannelRuntimeActionAdapter,
  ChannelRuntimeActionPayload,
} from '@xopcai/xopc/channels/plugins/types.adapters.js';
import { mergeDistinctSenderIds } from '@xopcai/xopc/channels/pairing/index.js';

import {
  beginAppRegistration,
  initAppRegistration,
  pollAppRegistration,
  type FeishuDomain,
  type AppRegistrationResult,
} from '../auth/app-registration.js';

type FeishuGatewaySetupDone =
  | { phase: 'done'; ok: true; accountId: string; appId: string; domain: FeishuDomain }
  | { phase: 'done'; ok: false; message: string };

type FeishuGatewaySetupActive = {
  startedAt: number;
  qrPayload: string;
};

const activeSessions = new Map<string, FeishuGatewaySetupActive>();
const completedSessions = new Map<string, FeishuGatewaySetupDone>();

function rememberCompleted(sessionKey: string, state: FeishuGatewaySetupDone): void {
  activeSessions.delete(sessionKey);
  completedSessions.set(sessionKey, state);
  setTimeout(() => completedSessions.delete(sessionKey), 10 * 60_000);
}

function readInput(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function normalizeDomain(input: unknown): FeishuDomain {
  return input === 'lark' ? 'lark' : 'feishu';
}

function buildFeishuConfig(config: Config, result: AppRegistrationResult): Config {
  const existing = config.channels?.feishu as Record<string, unknown> | undefined;
  const ownerOpenId = result.openId?.trim();
  const previousAllowFrom = Array.isArray(existing?.allowFrom)
    ? (existing.allowFrom as Array<string | number>)
    : [];
  const allowFrom = ownerOpenId
    ? mergeDistinctSenderIds(previousAllowFrom, [ownerOpenId])
    : previousAllowFrom;

  return {
    ...config,
    channels: {
      ...config.channels,
      feishu: {
        ...(existing ?? {}),
        enabled: true,
        appId: result.appId,
        appSecret: result.appSecret,
        domain: result.domain,
        connectionMode: 'websocket',
        dmPolicy: existing?.dmPolicy ?? 'open',
        groupPolicy: existing?.groupPolicy ?? 'allowlist',
        allowFrom,
        groupAllowFrom: Array.isArray(existing?.groupAllowFrom) ? existing.groupAllowFrom : [],
        requireMention: typeof existing?.requireMention === 'boolean' ? existing.requireMention : true,
        renderMode: existing?.renderMode ?? 'auto',
        streaming: typeof existing?.streaming === 'boolean' ? existing.streaming : false,
        reactionNotifications: existing?.reactionNotifications ?? 'own',
        actions: { ...(existing?.actions as Record<string, unknown> | undefined), reactions: true },
        tools: {
          doc: true,
          wiki: true,
          drive: true,
          perm: false,
          bitable: true,
          scopes: true,
          ...(existing?.tools as Record<string, unknown> | undefined),
        },
        historyLimit: typeof existing?.historyLimit === 'number' ? existing.historyLimit : 50,
        textChunkLimit: typeof existing?.textChunkLimit === 'number' ? existing.textChunkLimit : 4000,
      },
    },
  };
}

function statusPayload(
  state: FeishuGatewaySetupDone | undefined,
  active: FeishuGatewaySetupActive | undefined,
): ChannelRuntimeActionPayload {
  if (!state && active) {
    return {
      type: 'poll',
      phase: 'pending',
      ok: undefined,
      qrPayload: active.qrPayload,
      message: 'Waiting for Feishu/Lark confirmation...',
    };
  }
  if (!state) {
    return {
      type: 'poll',
      phase: 'unknown',
      ok: false,
      message: 'No active Feishu setup session. Start again or the QR may have expired.',
    };
  }
  if (state.ok === false) {
    return {
      type: 'poll',
      phase: 'done',
      ok: false,
      message: state.message,
    };
  }
  return {
    type: 'poll',
    phase: 'done',
    ok: true,
    accountId: state.accountId,
    appId: state.appId,
    domain: state.domain,
    message: 'Feishu setup complete.',
    configChanged: true,
  };
}

export const feishuGatewaySetupActions: ChannelRuntimeActionAdapter = {
  async runAction({ actionId, input }) {
    if (actionId === 'setup.start') {
      const raw = readInput(input);
      const domain = normalizeDomain(raw.domain);
      const supported = await initAppRegistration(domain);
      if (!supported) {
        return {
          ok: true,
          payload: {
            type: 'form',
            submitAction: 'setup.manual',
            message: 'Feishu scan-to-create is unavailable. Enter app credentials manually in Advanced configuration.',
            schema: {
              type: 'object',
              properties: {
                appId: { type: 'string', title: 'App ID' },
                appSecret: { type: 'string', title: 'App Secret', format: 'password' },
                domain: { type: 'string', enum: ['feishu', 'lark'], default: domain, title: 'Domain' },
              },
              required: ['appId', 'appSecret'],
            },
            values: { domain },
          },
        };
      }

      const begin = await beginAppRegistration(domain);
      const sessionKey = begin.deviceCode;
      activeSessions.set(sessionKey, {
        startedAt: Date.now(),
        qrPayload: begin.qrUrl,
      });

      void (async () => {
        const outcome = await pollAppRegistration({
          deviceCode: begin.deviceCode,
          intervalSec: begin.intervalSec,
          expireInSec: begin.expireInSec,
          initialDomain: domain,
        });

        if (outcome.status !== 'success') {
          const message =
            outcome.status === 'access_denied'
              ? 'User denied authorization.'
              : outcome.status === 'expired'
                ? 'Setup session expired.'
                : outcome.status === 'timeout'
                  ? 'Setup timed out.'
                  : outcome.message ?? 'Feishu setup failed.';
          rememberCompleted(sessionKey, { phase: 'done', ok: false, message });
          return;
        }

        try {
          const current = loadConfig();
          await saveConfig(buildFeishuConfig(current, outcome.result));
          rememberCompleted(sessionKey, {
            phase: 'done',
            ok: true,
            accountId: 'default',
            appId: outcome.result.appId,
            domain: outcome.result.domain,
          });
        } catch (err) {
          rememberCompleted(sessionKey, {
            phase: 'done',
            ok: false,
            message: `Config save failed: ${String(err)}`,
          });
        }
      })();

      return {
        ok: true,
        payload: {
          type: 'qr',
          sessionKey,
          qrPayload: begin.qrUrl,
          statusAction: 'setup.status',
          pollIntervalMs: Math.max(1000, begin.intervalSec * 1000),
          expiresInSec: begin.expireInSec,
          message: 'Scan with Feishu/Lark to create and authorize an app.',
        },
      };
    }

    if (actionId === 'setup.status') {
      const raw = readInput(input);
      const sessionKey = typeof raw.sessionKey === 'string' ? raw.sessionKey : '';
      if (!sessionKey) return { ok: false, message: 'Missing setup sessionKey' };
      return { ok: true, payload: statusPayload(completedSessions.get(sessionKey), activeSessions.get(sessionKey)) };
    }

    if (actionId === 'setup.manual') {
      const raw = readInput(input);
      const appId = typeof raw.appId === 'string' ? raw.appId.trim() : '';
      const appSecret = typeof raw.appSecret === 'string' ? raw.appSecret.trim() : '';
      const domain = normalizeDomain(raw.domain);
      if (!appId || !appSecret) {
        return { ok: false, message: 'App ID and App Secret are required.' };
      }
      const current = loadConfig();
      await saveConfig(buildFeishuConfig(current, { appId, appSecret, domain }));
      return {
        ok: true,
        payload: {
          type: 'ok',
          message: 'Feishu configuration saved.',
          configChanged: true,
        },
      };
    }

    return { ok: false, message: `Unsupported Feishu action: ${actionId}` };
  },
};
