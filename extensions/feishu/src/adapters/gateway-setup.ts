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

function isZh(locale: string | undefined): boolean {
  return locale?.toLowerCase().startsWith('zh') === true;
}

function statusPayload(
  state: FeishuGatewaySetupDone | undefined,
  active: FeishuGatewaySetupActive | undefined,
  locale?: string,
): ChannelRuntimeActionPayload {
  const zh = isZh(locale);
  if (!state && active) {
    return {
      type: 'poll',
      phase: 'pending',
      ok: undefined,
      qrPayload: active.qrPayload,
      message: zh ? '等待飞书 / Lark 确认…' : 'Waiting for Feishu/Lark confirmation...',
    };
  }
  if (!state) {
    return {
      type: 'poll',
      phase: 'unknown',
      ok: false,
      message: zh ? '没有活动的飞书配置会话。请重新开始，二维码可能已过期。' : 'No active Feishu setup session. Start again or the QR may have expired.',
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
    message: zh ? '飞书配置完成。' : 'Feishu setup complete.',
    configChanged: true,
  };
}

export const feishuGatewaySetupActions: ChannelRuntimeActionAdapter = {
  async runAction({ actionId, input, locale }) {
    const zh = isZh(locale);
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
            message: zh ? '飞书扫码创建不可用。请在高级配置中手动填写应用凭据。' : 'Feishu scan-to-create is unavailable. Enter app credentials manually in Advanced configuration.',
            schema: {
              type: 'object',
              properties: {
                appId: { type: 'string', title: 'App ID' },
                appSecret: { type: 'string', title: 'App Secret', format: 'password' },
                domain: { type: 'string', enum: ['feishu', 'lark'], default: domain, title: zh ? '域名' : 'Domain' },
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
              ? (zh ? '用户拒绝授权。' : 'User denied authorization.')
              : outcome.status === 'expired'
                ? (zh ? '配置会话已过期。' : 'Setup session expired.')
                : outcome.status === 'timeout'
                  ? (zh ? '配置超时。' : 'Setup timed out.')
                  : outcome.message ?? (zh ? '飞书配置失败。' : 'Feishu setup failed.');
          rememberCompleted(sessionKey, { phase: 'done', ok: false, message });
          return;
        }

        try {
          const { loadConfig, saveConfig } = await import('@xopcai/xopc/config/loader.js');
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
            message: `${zh ? '配置保存失败' : 'Config save failed'}: ${String(err)}`,
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
          message: zh ? '请使用飞书 / Lark 扫码创建并授权应用。' : 'Scan with Feishu/Lark to create and authorize an app.',
        },
      };
    }

    if (actionId === 'setup.status') {
      const raw = readInput(input);
      const sessionKey = typeof raw.sessionKey === 'string' ? raw.sessionKey : '';
      if (!sessionKey) return { ok: false, message: zh ? '缺少配置 sessionKey' : 'Missing setup sessionKey' };
      return { ok: true, payload: statusPayload(completedSessions.get(sessionKey), activeSessions.get(sessionKey), locale) };
    }

    if (actionId === 'setup.manual') {
      const raw = readInput(input);
      const appId = typeof raw.appId === 'string' ? raw.appId.trim() : '';
      const appSecret = typeof raw.appSecret === 'string' ? raw.appSecret.trim() : '';
      const domain = normalizeDomain(raw.domain);
      if (!appId || !appSecret) {
        return { ok: false, message: zh ? 'App ID 和 App Secret 为必填项。' : 'App ID and App Secret are required.' };
      }
      const { loadConfig, saveConfig } = await import('@xopcai/xopc/config/loader.js');
      const current = loadConfig();
      await saveConfig(buildFeishuConfig(current, { appId, appSecret, domain }));
      return {
        ok: true,
        payload: {
          type: 'ok',
          message: zh ? '飞书配置已保存。' : 'Feishu configuration saved.',
          configChanged: true,
        },
      };
    }

    return { ok: false, message: `${zh ? '不支持的飞书操作' : 'Unsupported Feishu action'}: ${actionId}` };
  },
};
