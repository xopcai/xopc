import { createHash, randomUUID } from 'node:crypto';

import type { FeishuConfig } from '../schema/config-schema.js';
import { cancelChannelConnectionProbe, getChannelConnectionProbe, startChannelConnectionProbe } from '@xopcai/xopc/channels/connection-probe.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type {
  ChannelRuntimeActionAdapter,
} from '@xopcai/xopc/channels/plugins/types.adapters.js';

import {
  beginAppRegistration,
  initAppRegistration,
  pollAppRegistration,
  type FeishuDomain,
  type AppRegistrationResult,
} from '../auth/app-registration.js';
import { probeFeishuBot } from '../transport/client/bot-info.js';
import { ensureFeishuLarkSdk } from '../transport/client/lark-sdk.js';

type SetupSession = {
  accountId: string;
  controller: AbortController;
  configHash: string;
  qrUrl: string;
  expiresAt: number;
  outcome?: { ok: true; result: AppRegistrationResult } | { ok: false; message: string };
};

const sessions = new Map<string, SetupSession>();
const channelHash = (cfg: Config) => createHash('sha256').update(JSON.stringify(cfg.channels?.feishu ?? {})).digest('hex');

function cancelSetup(id: string): void {
  sessions.get(id)?.controller.abort();
  sessions.delete(id);
}

function readInput(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function normalizeDomain(input: unknown): FeishuDomain {
  return input === 'lark' ? 'lark' : 'feishu';
}

export function buildFeishuConfig(config: Config, result: AppRegistrationResult, accountId = 'default'): Config {
  const existing = config.channels?.feishu as FeishuConfig | undefined;
  const account = Object.hasOwn(existing?.accounts ?? {}, accountId) ? existing?.accounts?.[accountId] : undefined;
  const ownerOpenId = result.openId?.trim();
  const sameApp = account?.appId === result.appId && (account.domain ?? existing?.domain ?? 'feishu') === result.domain;
  const access = sameApp ? {} : {
    dmPolicy: ownerOpenId ? 'allowlist' as const : 'pairing' as const,
    allowFrom: ownerOpenId ? [ownerOpenId] : [],
    groupPolicy: 'allowlist' as const,
    groupAllowFrom: [],
    requireMention: true,
    tools: { doc: false, wiki: false, drive: false, perm: false, bitable: false, scopes: false },
  };

  return {
    ...config,
    channels: {
      ...config.channels,
      feishu: {
        ...existing,
        enabled: true,
        accounts: {
          ...existing?.accounts,
          [accountId]: {
            ...(sameApp ? account : undefined),
            ...access,
            enabled: true,
            appId: result.appId,
            appSecret: result.appSecret,
            domain: result.domain,
            connectionMode: sameApp ? account.connectionMode ?? existing?.connectionMode ?? 'websocket' : 'websocket',
          },
        },
      },
    },
  };
}

function isZh(locale: string | undefined): boolean {
  return locale?.toLowerCase().startsWith('zh') === true;
}

function setupVerification(result: AppRegistrationResult, accountId: string, zh: boolean, info: Awaited<ReturnType<typeof probeFeishuBot>>) {
  return {
    ...startChannelConnectionProbe({
      channel: 'feishu', accountId, identity: result.appId, ownerId: result.openId?.trim(), zh, configChanged: true,
    }),
    ...(info.ok && info.name ? { botName: info.name } : {}),
    ...(!info.ok ? {
      setupHint: zh
        ? '若找不到机器人，请在开放平台检查机器人能力、长连接事件订阅、发布和管理员审批。'
        : 'If the bot is unavailable, check bot access, long-connection subscriptions, publication and administrator approval.',
    } : {}),
  };
}

function manualSetupForm(domain: ReturnType<typeof normalizeDomain>, message?: string) {
  return {
    type: 'form' as const,
    submitAction: 'setup.manual',
    message,
    schema: {
      type: 'object',
      properties: {
        appId: { type: 'string', title: 'App ID' },
        appSecret: { type: 'string', title: 'App Secret', format: 'password' },
        domain: { type: 'string', enum: ['feishu', 'lark'], default: domain },
      },
      required: ['appId', 'appSecret'],
    },
    values: { domain },
  };
}

export const feishuGatewaySetupActions: ChannelRuntimeActionAdapter = {
  async runAction({ cfg, actionId, input, locale, accountId: requestedAccountId }) {
    const zh = isZh(locale);
    const raw = readInput(input);
    const id = typeof raw.conversationId === 'string' ? raw.conversationId : '';
    const accountId = requestedAccountId || 'default';
    const domain = normalizeDomain(raw.domain);
    if (actionId === 'setup.verify.status') {
      return { ok: true, payload: getChannelConnectionProbe('feishu', accountId, id, zh) };
    }
    if (actionId === 'setup.verify.cancel') {
      cancelChannelConnectionProbe('feishu', accountId, id);
      return { ok: true, payload: { type: 'ok' } };
    }
    if (actionId === 'setup.cancel') {
      if (sessions.get(id)?.accountId === accountId) cancelSetup(id);
      return { ok: true, payload: { type: 'ok' } };
    }

    if (actionId === 'setup.manual' && raw.appId === undefined && raw.appSecret === undefined) {
      return { ok: true, payload: manualSetupForm(domain) };
    }

    if (actionId === 'setup.start' || actionId === 'setup.manual') {
      try {
        await ensureFeishuLarkSdk();
      } catch {
        return {
          ok: false,
          message: zh ? '飞书组件安装失败。请检查网络后重试。' : 'Could not install the Feishu component. Check the network and retry.',
        };
      }
    }
    if (actionId === 'setup.start') {
      const supported = await initAppRegistration(domain);
      if (!supported) {
        return {
          ok: true,
          payload: manualSetupForm(domain, zh
            ? '扫码创建暂不可用，请填写应用凭据。'
            : 'Scan-to-create is unavailable. Enter app credentials.'),
        };
      }

      const begin = await beginAppRegistration(domain);
      const conversationId = randomUUID();
      const expireInSec = Math.max(1, Math.min(600, begin.expireInSec));
      for (const [activeId, active] of sessions) {
        if (active.accountId === accountId) cancelSetup(activeId);
      }
      const session: SetupSession = {
        accountId,
        controller: new AbortController(),
        configHash: channelHash(cfg),
        qrUrl: begin.qrUrl,
        expiresAt: Date.now() + expireInSec * 1000,
      };
      sessions.set(conversationId, session);
      setTimeout(() => cancelSetup(conversationId), expireInSec * 1000).unref();
      void pollAppRegistration({
        deviceCode: begin.deviceCode,
        intervalSec: begin.intervalSec,
        expireInSec,
        initialDomain: domain,
        signal: session.controller.signal,
      }).then(outcome => {
        if (outcome.status === 'success') session.outcome = { ok: true, result: outcome.result };
        else session.outcome = {
          ok: false,
          message: outcome.status === 'access_denied'
            ? (zh ? '已拒绝授权。' : 'Authorization denied.')
            : (zh ? '授权未完成，请重试。' : 'Authorization did not finish. Please retry.'),
        };
      }).catch(() => {
        session.outcome = { ok: false, message: zh ? '授权已结束。' : 'Authorization ended.' };
      });

      return {
        ok: true,
        payload: {
          type: 'qr', conversationId, accountId, qrPayload: begin.qrUrl,
          statusAction: 'setup.status', cancelAction: 'setup.cancel', expiresInSec: expireInSec,
          pollIntervalMs: Math.max(1000, begin.intervalSec * 1000),
          message: zh ? '使用飞书或 Lark 扫码创建并授权应用。' : 'Scan with Feishu or Lark to create and authorize the app.',
        },
      };
    }

    if (actionId === 'setup.status') {
      const session = sessions.get(id);
      if (!session || session.accountId !== accountId || session.expiresAt <= Date.now()) {
        return { ok: true, payload: { type: 'poll', phase: 'unknown', ok: false, message: zh ? '二维码已过期，请重新连接。' : 'The QR code expired. Connect again.' } };
      }
      if (session.configHash !== channelHash(cfg)) {
        cancelSetup(id);
        return { ok: true, payload: { type: 'poll', phase: 'done', ok: false, message: zh ? '飞书设置已变更，请重新连接。' : 'Feishu settings changed. Connect again.' } };
      }
      if (!session.outcome) return { ok: true, payload: { type: 'poll', phase: 'pending', qrPayload: session.qrUrl } };
      if (session.outcome.ok === false) {
        const { message } = session.outcome;
        cancelSetup(id);
        return { ok: true, payload: { type: 'poll', phase: 'done', ok: false, message } };
      }
      const { result } = session.outcome;
      const info = await probeFeishuBot(result).catch(() => ({ ok: false as const }));
      if (sessions.get(id) !== session) return { ok: false, message: zh ? '授权会话已结束。' : 'Authorization session ended.' };
      return {
        ok: true,
        nextConfig: buildFeishuConfig(cfg, result, accountId),
        beforeConfigSaved: () => {
          if (sessions.get(id) !== session) throw new Error('Feishu setup session is no longer active');
        },
        onConfigSaved: () => {
          cancelSetup(id);
          return setupVerification(result, accountId, zh, info);
        },
      };
    }

    if (actionId === 'setup.manual') {
      const appId = typeof raw.appId === 'string' ? raw.appId.trim() : '';
      const appSecret = typeof raw.appSecret === 'string' ? raw.appSecret.trim() : '';
      if (!appId || !appSecret) return { ok: false, message: zh ? '请填写 App ID 和 App Secret。' : 'Enter the App ID and App Secret.' };
      const result = { appId, appSecret, domain };
      const info = await probeFeishuBot(result).catch(() => ({ ok: false as const }));
      return { ok: true, nextConfig: buildFeishuConfig(cfg, result, accountId), onConfigSaved: () => setupVerification(result, accountId, zh, info) };
    }

    return { ok: false, message: zh ? '不支持的飞书操作。' : 'Unsupported Feishu action.' };
  },
};
