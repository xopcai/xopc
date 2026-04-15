import type { Hono } from 'hono';

import { type Config, BindingsConfigSchema } from '../../../config/schema.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { applyToolsWebPatch } from '../../config-tools-web.js';
import { buildSafeWebConfigPayload } from '../lib/config-payload.js';
import { normalizePatchAgentModel } from '../lib/agent-model.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerConfigRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.post('/api/config/reload', strictRateLimitMiddleware, async (c) => {
    const result = await service.reloadConfig();
    return c.json({ ok: true, payload: result });
  });

  authenticated.post('/api/heartbeat/trigger', strictRateLimitMiddleware, async (c) => {
    let reason = 'manual';
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string') {
        const r = (body as { reason: string }).reason.trim();
        if (r) reason = r.slice(0, 120);
      }
    } catch {
      /* empty or invalid body */
    }
    service.requestHeartbeatNow({ reason });
    return c.json({ ok: true, payload: { scheduled: true } });
  });

  authenticated.get('/api/config', async (c) => {
    const safeConfig = await buildSafeWebConfigPayload(service);
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  authenticated.patch('/api/config', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json();
    
    // Merge updates into current config
    const config: Config = service.currentConfig as Config;
    
    // Update agent defaults
    if (body.agents?.defaults) {
      if (!config.agents) config.agents = { defaults: { workspace: '~/.xopc/workspace', model: 'anthropic/claude-sonnet-4-5', maxTokens: 8192, temperature: 0.7, maxToolIterations: 20, maxRequestsPerTurn: 50, maxToolFailuresPerTurn: 3, thinkingDefault: 'medium', reasoningDefault: 'off', verboseDefault: 'off' } };
      if (!config.agents.defaults) config.agents.defaults = {} as any;
      
      if (body.agents.defaults.model !== undefined) {
        config.agents.defaults.model = normalizePatchAgentModel(body.agents.defaults.model) as Config['agents']['defaults']['model'];
      }
      if (body.agents.defaults.maxTokens !== undefined) {
        config.agents.defaults.maxTokens = body.agents.defaults.maxTokens;
      }
      if (body.agents.defaults.temperature !== undefined) {
        config.agents.defaults.temperature = body.agents.defaults.temperature;
      }
      if (body.agents.defaults.maxToolIterations !== undefined) {
        config.agents.defaults.maxToolIterations = body.agents.defaults.maxToolIterations;
      }
      if (body.agents.defaults.workspace !== undefined) {
        config.agents.defaults.workspace = body.agents.defaults.workspace;
      }
      if (body.agents.defaults.thinkingDefault !== undefined) {
        config.agents.defaults.thinkingDefault = body.agents.defaults.thinkingDefault;
      }
      if (body.agents.defaults.reasoningDefault !== undefined) {
        config.agents.defaults.reasoningDefault = body.agents.defaults.reasoningDefault;
      }
      if (body.agents.defaults.verboseDefault !== undefined) {
        config.agents.defaults.verboseDefault = body.agents.defaults.verboseDefault;
      }
      if (body.agents.defaults.imageModel !== undefined) {
        const v = body.agents.defaults.imageModel;
        if (v === '' || v === null) {
          delete (config.agents.defaults as Record<string, unknown>).imageModel;
        } else {
          config.agents.defaults.imageModel = normalizePatchAgentModel(v) as Config['agents']['defaults']['imageModel'];
        }
      }
      if (body.agents.defaults.imageGenerationModel !== undefined) {
        const v = body.agents.defaults.imageGenerationModel;
        if (v === '' || v === null) {
          delete (config.agents.defaults as Record<string, unknown>).imageGenerationModel;
        } else {
          config.agents.defaults.imageGenerationModel = normalizePatchAgentModel(
            v,
          ) as Config['agents']['defaults']['imageGenerationModel'];
        }
      }
      if (body.agents.defaults.mediaMaxMb !== undefined) {
        const v = body.agents.defaults.mediaMaxMb;
        if (v === null) {
          delete (config.agents.defaults as Record<string, unknown>).mediaMaxMb;
        } else {
          const n = typeof v === 'number' ? v : Number(v);
          if (!Number.isNaN(n) && n > 0) {
            config.agents.defaults.mediaMaxMb = n;
          }
        }
      }
      if (body.agents.defaults.browser !== undefined) {
        const b = body.agents.defaults.browser;
        if (b === null) {
          delete (config.agents.defaults as Record<string, unknown>).browser;
        } else if (typeof b === 'object' && !Array.isArray(b)) {
          const br = b as Record<string, unknown>;
          if (!config.agents.defaults.browser) {
            config.agents.defaults.browser = { enabled: false, headless: true };
          }
          const target = config.agents.defaults.browser;
          if (br.enabled !== undefined) {
            target.enabled = Boolean(br.enabled);
          }
          if (br.headless !== undefined) {
            target.headless = Boolean(br.headless);
          }
        }
      }
    }
    
    // Update channels — use `in` / null so `weixin: null` removes the block; avoid `if (ch.weixin)` missing null.
    const patchChannels = body.channels;
    if (patchChannels != null && typeof patchChannels === 'object' && !Array.isArray(patchChannels)) {
      if ('telegram' in patchChannels) {
        const tgRaw = patchChannels.telegram;
        if (tgRaw === null) {
          if (config.channels) delete config.channels.telegram;
        } else if (typeof tgRaw === 'object' && !Array.isArray(tgRaw)) {
          const bodyTg = tgRaw as Record<string, unknown>;
          if (!config.channels) config.channels = { telegram: { enabled: false, botToken: '', allowFrom: [], groupAllowFrom: [], debug: false, dmPolicy: 'pairing' as const, groupPolicy: 'open' as const, replyToMode: 'off' as const, historyLimit: 50, textChunkLimit: 4000 } };
          if (!config.channels.telegram) config.channels.telegram = {} as any;
          const tg = config.channels.telegram as Record<string, unknown>;

          if (bodyTg.enabled !== undefined) {
            tg.enabled = bodyTg.enabled;
          }
          if (bodyTg.botToken !== undefined) {
            tg.botToken = bodyTg.botToken;
          }
          if (bodyTg.allowFrom !== undefined) {
            tg.allowFrom = bodyTg.allowFrom;
          }
          if (bodyTg.apiRoot !== undefined) {
            tg.apiRoot = bodyTg.apiRoot;
          }
          if (bodyTg.debug !== undefined) {
            tg.debug = bodyTg.debug;
          }
          if (bodyTg.streamMode !== undefined) {
            tg.streamMode = bodyTg.streamMode;
          }
          if (bodyTg.groupAllowFrom !== undefined) {
            tg.groupAllowFrom = bodyTg.groupAllowFrom;
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
          if (bodyTg.proxy !== undefined) {
            tg.proxy = bodyTg.proxy;
          }
          if (bodyTg.accounts !== undefined) {
            tg.accounts = bodyTg.accounts;
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
              dmPolicy: 'pairing',
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
    }
    
    // Update gateway heartbeat (partial merge)
    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      if (!config.gateway) {
        config.gateway = {
          host: '0.0.0.0',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000 },
          maxSseConnections: 100,
          corsOrigins: ['*'],
        };
      }
      if (!config.gateway.heartbeat) config.gateway.heartbeat = { enabled: true, intervalMs: 1_800_000 };
      const h = config.gateway.heartbeat;
      const p = body.gateway.heartbeat as Record<string, unknown>;
      if (p.enabled !== undefined) h.enabled = Boolean(p.enabled);
      if (p.intervalMs !== undefined && typeof p.intervalMs === 'number' && Number.isFinite(p.intervalMs)) {
        h.intervalMs = p.intervalMs;
      }
      if (p.target !== undefined) {
        if (p.target === null || p.target === '') delete (h as { target?: string }).target;
        else (h as { target?: string }).target = String(p.target);
      }
      if (p.targetChatId !== undefined) {
        if (p.targetChatId === null || p.targetChatId === '') delete (h as { targetChatId?: string }).targetChatId;
        else (h as { targetChatId?: string }).targetChatId = String(p.targetChatId);
      }
      if (p.prompt !== undefined) {
        if (p.prompt === null || p.prompt === '') delete (h as { prompt?: string }).prompt;
        else (h as { prompt?: string }).prompt = String(p.prompt);
      }
      if (p.ackMaxChars !== undefined) {
        if (p.ackMaxChars === null || p.ackMaxChars === '') delete (h as { ackMaxChars?: number }).ackMaxChars;
        else if (typeof p.ackMaxChars === 'number' && Number.isFinite(p.ackMaxChars)) {
          (h as { ackMaxChars?: number }).ackMaxChars = p.ackMaxChars;
        }
      }
      if (p.isolatedSession !== undefined) {
        if (p.isolatedSession === null || p.isolatedSession === false) {
          delete (h as { isolatedSession?: boolean }).isolatedSession;
        } else {
          (h as { isolatedSession?: boolean }).isolatedSession = Boolean(p.isolatedSession);
        }
      }
      if (p.activeHours !== undefined) {
        if (p.activeHours === null) {
          delete (h as { activeHours?: unknown }).activeHours;
        } else if (typeof p.activeHours === 'object' && p.activeHours !== null) {
          const ah = p.activeHours as Record<string, unknown>;
          const start = typeof ah.start === 'string' ? ah.start : '';
          const end = typeof ah.end === 'string' ? ah.end : '';
          if (start && end) {
            (h as { activeHours?: { start: string; end: string; timezone?: string } }).activeHours = {
              start,
              end,
              ...(typeof ah.timezone === 'string' && ah.timezone.trim() ? { timezone: ah.timezone } : {}),
            };
          } else {
            delete (h as { activeHours?: unknown }).activeHours;
          }
        }
      }
    }
    if (body.gateway?.auth !== undefined) {
      if (!config.gateway) config.gateway = { host: '0.0.0.0', port: 18790, heartbeat: { enabled: true, intervalMs: 1_800_000 }, maxSseConnections: 100, corsOrigins: ['*'] };
      if (!config.gateway.auth) config.gateway.auth = { mode: 'token' };
      const a = body.gateway.auth;
      if (a.mode !== undefined) {
        config.gateway.auth.mode = a.mode;
      }
      if (a.token !== undefined) {
        config.gateway.auth.token = a.token;
      }
    }

    // Update providers config - save to credential system instead of config
    if (body.providers) {
      const resolver = new CredentialResolver();
      for (const [key, apiKey] of Object.entries(body.providers)) {
        if (
          apiKey !== undefined &&
          typeof apiKey === 'string' &&
          apiKey.trim() &&
          apiKey !== '***' &&
          apiKey !== '••••••••••••'
        ) {
          await resolver.saveApiKey(key, apiKey, { profileName: 'default' });
        }
      }
    }

    // Update STT config
    if (body.stt !== undefined) {
      config.stt = body.stt;
    }

    // Update TTS config
    if (body.tts !== undefined) {
      config.tts = body.tts;
    }

    const toolsPatchErr = applyToolsWebPatch(config, body as Record<string, unknown>);
    if (toolsPatchErr) {
      return c.json({ ok: false, error: { message: toolsPatchErr } }, 400);
    }

    if (body.bindings !== undefined) {
      if (!Array.isArray(body.bindings)) {
        return c.json({ ok: false, error: { message: 'bindings must be an array' } }, 400);
      }
      const parsed = BindingsConfigSchema.safeParse(body.bindings);
      if (!parsed.success) {
        return c.json(
          { ok: false, error: { message: parsed.error.issues.map((i) => i.message).join('; ') } },
          400,
        );
      }
      config.bindings = parsed.data;
    }

    // Save config
    const result = await service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error }, 500);
    }

    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      service.reloadHeartbeatFromCurrentConfig();
    }

    const safeConfig = await buildSafeWebConfigPayload(service);
    return c.json({ ok: true, payload: { config: safeConfig } });
  });
}
