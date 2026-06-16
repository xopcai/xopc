/**
 * `PATCH /api/config` — `body.channels.{telegram,weixin,feishu}` section.
 *
 * Uses `in patchChannels` / `null` semantics so the web UI can remove a
 * provider with `{ weixin: null }` — `if (ch.weixin)` would silently drop
 * those clears.
 *
 * Each provider has its own first-init template (so a brand-new install gets
 * sane account / policy defaults), then field-by-field overlay.
 */
import type { Config } from '../../../../config/schema.js';

export function applyChannelsPatch(config: Config, body: any): void {
  const patchChannels = body.channels;
  if (patchChannels == null || typeof patchChannels !== 'object' || Array.isArray(patchChannels)) {
    return;
  }

  if ('telegram' in patchChannels) {
    const tgRaw = patchChannels.telegram;
    if (tgRaw === null) {
      if (config.channels) delete config.channels.telegram;
    } else if (typeof tgRaw === 'object' && !Array.isArray(tgRaw)) {
      const bodyTg = tgRaw as Record<string, unknown>;
      if (!config.channels) {
        config.channels = {
          telegram: {
            enabled: false,
            allowFrom: [],
            groupAllowFrom: [],
            debug: false,
            accounts: {
              default: {
                accountId: 'default',
                enabled: true,
                botToken: '',
                allowFrom: [],
                dmPolicy: 'pairing' as const,
                groupPolicy: 'open' as const,
                replyToMode: 'off' as const,
                historyLimit: 50,
                textChunkLimit: 4000,
                streamMode: 'partial' as const,
              },
            },
            dmPolicy: 'pairing' as const,
            groupPolicy: 'open' as const,
            replyToMode: 'off' as const,
            historyLimit: 50,
            textChunkLimit: 4000,
          },
        };
      }
      if (!config.channels.telegram) config.channels.telegram = {} as any;
      const tg = config.channels.telegram as Record<string, unknown>;

      if (bodyTg.enabled !== undefined) {
        tg.enabled = bodyTg.enabled;
      }
      if (bodyTg.allowFrom !== undefined) {
        tg.allowFrom = bodyTg.allowFrom;
      }
      if ('apiRoot' in bodyTg) {
        const ar = bodyTg.apiRoot;
        if (ar === null || ar === undefined || (typeof ar === 'string' && !ar.trim())) {
          delete tg.apiRoot;
        } else {
          tg.apiRoot = String(ar).trim();
        }
      }
      if (bodyTg.debug !== undefined) {
        tg.debug = bodyTg.debug;
      }
      if (bodyTg.streamMode !== undefined) {
        tg.streamMode = bodyTg.streamMode;
      }
      if ('groupAllowFrom' in bodyTg) {
        const ga = bodyTg.groupAllowFrom;
        if (ga === null || (Array.isArray(ga) && ga.length === 0)) {
          delete tg.groupAllowFrom;
        } else {
          tg.groupAllowFrom = ga;
        }
      }
      if (bodyTg.dmPolicy !== undefined) {
        tg.dmPolicy = bodyTg.dmPolicy;
      }
      if (bodyTg.groupPolicy !== undefined) {
        tg.groupPolicy = bodyTg.groupPolicy;
      }
      if (bodyTg.replyToMode !== undefined) {
        tg.replyToMode = bodyTg.replyToMode;
      }
      if (bodyTg.historyLimit !== undefined) {
        tg.historyLimit = bodyTg.historyLimit;
      }
      if (bodyTg.textChunkLimit !== undefined) {
        tg.textChunkLimit = bodyTg.textChunkLimit;
      }
      if ('proxy' in bodyTg) {
        const pr = bodyTg.proxy;
        if (pr === null || pr === undefined || (typeof pr === 'string' && !pr.trim())) {
          delete tg.proxy;
        } else {
          tg.proxy = String(pr).trim();
        }
      }
      if (bodyTg.accounts !== undefined) {
        tg.accounts = bodyTg.accounts;
      }
      if (bodyTg.reactionLevel !== undefined) {
        tg.reactionLevel = bodyTg.reactionLevel;
      }
      if (bodyTg.reactionNotifications !== undefined) {
        tg.reactionNotifications = bodyTg.reactionNotifications;
      }
      if ('ackReaction' in bodyTg) {
        const ar = bodyTg.ackReaction;
        if (ar === null || ar === undefined || (typeof ar === 'string' && !ar.trim())) {
          delete tg.ackReaction;
        } else {
          tg.ackReaction = String(ar).trim();
        }
      }
    }
  }

  if ('weixin' in patchChannels) {
    const wxRaw = patchChannels.weixin;
    if (wxRaw === null) {
      if (config.channels) delete config.channels.weixin;
    } else if (typeof wxRaw === 'object' && !Array.isArray(wxRaw)) {
      const wx = wxRaw as Record<string, unknown>;
      if (!config.channels) config.channels = {} as any;
      if (!config.channels.weixin) {
        config.channels.weixin = {
          enabled: false,
          dmPolicy: 'open',
          allowFrom: [],
          debug: false,
          historyLimit: 50,
          textChunkLimit: 4000,
        };
      }
      const wxTarget = config.channels.weixin as Record<string, unknown>;
      if (wx.enabled !== undefined) wxTarget.enabled = wx.enabled;
      if (wx.dmPolicy !== undefined) wxTarget.dmPolicy = wx.dmPolicy;
      if (wx.allowFrom !== undefined) wxTarget.allowFrom = wx.allowFrom;
      if (wx.debug !== undefined) wxTarget.debug = wx.debug;
      if (wx.streamMode !== undefined) wxTarget.streamMode = wx.streamMode;
      if (wx.historyLimit !== undefined) wxTarget.historyLimit = wx.historyLimit;
      if (wx.textChunkLimit !== undefined) wxTarget.textChunkLimit = wx.textChunkLimit;
      if ('routeTag' in wx) {
        const rt = wx.routeTag;
        if (rt === null || rt === undefined || rt === '') {
          delete wxTarget.routeTag;
        } else {
          wxTarget.routeTag = rt as string | number;
        }
      }
      if (wx.accounts !== undefined) wxTarget.accounts = wx.accounts;
    }
  }

  if ('feishu' in patchChannels) {
    const fsRaw = patchChannels.feishu;
    if (fsRaw === null) {
      if (config.channels) delete config.channels.feishu;
    } else if (typeof fsRaw === 'object' && !Array.isArray(fsRaw)) {
      const fs = fsRaw as Record<string, unknown>;
      if (!config.channels) config.channels = {} as any;
      if (!config.channels.feishu) {
        config.channels.feishu = {
          enabled: false,
          appId: '',
          appSecret: '',
          domain: 'feishu',
          connectionMode: 'websocket',
          dmPolicy: 'open',
          groupPolicy: 'allowlist',
          allowFrom: [],
          groupAllowFrom: [],
          requireMention: true,
          historyLimit: 50,
          textChunkLimit: 4000,
          accounts: {},
        };
      }
      const fsTarget = config.channels.feishu as Record<string, unknown>;

      if (fs.enabled !== undefined) fsTarget.enabled = fs.enabled;
      if (fs.defaultAccount !== undefined) {
        const da = fs.defaultAccount;
        if (da === null || da === '') delete fsTarget.defaultAccount;
        else fsTarget.defaultAccount = String(da);
      }
      if (fs.appId !== undefined) fsTarget.appId = fs.appId;
      if ('appSecret' in fs) {
        const v = fs.appSecret;
        if (v === null || (typeof v === 'string' && !String(v).trim())) {
          delete fsTarget.appSecret;
        } else {
          fsTarget.appSecret = v;
        }
      }
      if (fs.domain !== undefined) fsTarget.domain = fs.domain;
      if (fs.connectionMode !== undefined) fsTarget.connectionMode = fs.connectionMode;
      if (fs.verificationToken !== undefined) {
        const v = fs.verificationToken;
        if (v === null || (typeof v === 'string' && !String(v).trim())) delete fsTarget.verificationToken;
        else fsTarget.verificationToken = v;
      }
      if (fs.encryptKey !== undefined) {
        const v = fs.encryptKey;
        if (v === null || (typeof v === 'string' && !String(v).trim())) delete fsTarget.encryptKey;
        else fsTarget.encryptKey = v;
      }
      if (fs.webhookHost !== undefined) {
        const v = fs.webhookHost;
        if (v === null || (typeof v === 'string' && !String(v).trim())) delete fsTarget.webhookHost;
        else fsTarget.webhookHost = v;
      }
      if (fs.webhookPort !== undefined) fsTarget.webhookPort = fs.webhookPort;
      if (fs.webhookPath !== undefined) {
        const v = fs.webhookPath;
        if (v === null || (typeof v === 'string' && !String(v).trim())) delete fsTarget.webhookPath;
        else fsTarget.webhookPath = v;
      }
      if (fs.dmPolicy !== undefined) fsTarget.dmPolicy = fs.dmPolicy;
      if (fs.groupPolicy !== undefined) fsTarget.groupPolicy = fs.groupPolicy;
      if (fs.allowFrom !== undefined) fsTarget.allowFrom = fs.allowFrom;
      if (fs.groupAllowFrom !== undefined) {
        const ga = fs.groupAllowFrom;
        if (ga === null || (Array.isArray(ga) && ga.length === 0)) delete fsTarget.groupAllowFrom;
        else fsTarget.groupAllowFrom = ga;
      }
      if (fs.requireMention !== undefined) fsTarget.requireMention = fs.requireMention;
      if (fs.historyLimit !== undefined) fsTarget.historyLimit = fs.historyLimit;
      if (fs.textChunkLimit !== undefined) fsTarget.textChunkLimit = fs.textChunkLimit;
      if (fs.renderMode !== undefined) fsTarget.renderMode = fs.renderMode;
      if (fs.streaming !== undefined) fsTarget.streaming = fs.streaming;
      if (fs.reactionNotifications !== undefined) {
        fsTarget.reactionNotifications = fs.reactionNotifications;
      }
      if (fs.tools !== undefined) fsTarget.tools = fs.tools;
      if (fs.actions !== undefined) fsTarget.actions = fs.actions;
      if (fs.accounts !== undefined) fsTarget.accounts = fs.accounts;
    }
  }
}
