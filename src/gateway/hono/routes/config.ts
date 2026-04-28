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

      const dPatch = body.agents.defaults as Record<string, unknown>;
      const def = config.agents.defaults as Record<string, unknown>;

      if (dPatch.maxTaskDurationMs !== undefined) {
        const v = dPatch.maxTaskDurationMs;
        if (v === null) {
          delete def.maxTaskDurationMs;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          const ms = Math.floor(v);
          if (ms >= 60_000 && ms <= 14_400_000) {
            def.maxTaskDurationMs = ms;
          }
        }
      }
      if (dPatch.maxRequestsPerTurn !== undefined) {
        const v = dPatch.maxRequestsPerTurn;
        if (v === null) {
          delete def.maxRequestsPerTurn;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          const n = Math.floor(v);
          if (n >= 10 && n <= 200) {
            def.maxRequestsPerTurn = n;
          }
        }
      }
      if (dPatch.maxToolFailuresPerTurn !== undefined) {
        const v = dPatch.maxToolFailuresPerTurn;
        if (v === null) {
          delete def.maxToolFailuresPerTurn;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          const n = Math.floor(v);
          if (n >= 1 && n <= 20) {
            def.maxToolFailuresPerTurn = n;
          }
        }
      }

      if (dPatch.compaction !== undefined) {
        const c = dPatch.compaction;
        if (c === null) {
          delete def.compaction;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.compaction || typeof def.compaction !== 'object') {
            def.compaction = {};
          }
          const t = def.compaction as Record<string, unknown>;
          if (p.enabled !== undefined) t.enabled = Boolean(p.enabled);
          if (p.mode === 'default' || p.mode === 'safeguard') t.mode = p.mode;
          if (typeof p.reserveTokens === 'number' && Number.isFinite(p.reserveTokens)) {
            t.reserveTokens = Math.floor(p.reserveTokens);
          }
          if (typeof p.triggerThreshold === 'number' && Number.isFinite(p.triggerThreshold)) {
            const x = p.triggerThreshold;
            if (x >= 0.5 && x <= 0.95) t.triggerThreshold = x;
          }
          if (typeof p.minMessagesBeforeCompact === 'number' && Number.isFinite(p.minMessagesBeforeCompact)) {
            t.minMessagesBeforeCompact = Math.floor(p.minMessagesBeforeCompact);
          }
          if (typeof p.keepRecentMessages === 'number' && Number.isFinite(p.keepRecentMessages)) {
            t.keepRecentMessages = Math.floor(p.keepRecentMessages);
          }
          if (typeof p.evictionWindow === 'number' && Number.isFinite(p.evictionWindow)) {
            const x = p.evictionWindow;
            if (x >= 0.1 && x <= 0.5) t.evictionWindow = x;
          }
          if (typeof p.retentionWindow === 'number' && Number.isFinite(p.retentionWindow)) {
            const n = Math.floor(p.retentionWindow);
            if (n >= 3 && n <= 20) t.retentionWindow = n;
          }
        }
      }

      if (dPatch.pruning !== undefined) {
        const c = dPatch.pruning;
        if (c === null) {
          delete def.pruning;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.pruning || typeof def.pruning !== 'object') {
            def.pruning = {};
          }
          const t = def.pruning as Record<string, unknown>;
          if (p.enabled !== undefined) t.enabled = Boolean(p.enabled);
          if (typeof p.maxToolResultChars === 'number' && Number.isFinite(p.maxToolResultChars)) {
            t.maxToolResultChars = Math.floor(p.maxToolResultChars);
          }
          if (typeof p.headKeepRatio === 'number' && Number.isFinite(p.headKeepRatio)) {
            t.headKeepRatio = p.headKeepRatio;
          }
          if (typeof p.tailKeepRatio === 'number' && Number.isFinite(p.tailKeepRatio)) {
            t.tailKeepRatio = p.tailKeepRatio;
          }
        }
      }

      if (dPatch.memory !== undefined) {
        const c = dPatch.memory;
        if (c === null) {
          delete def.memory;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.memory || typeof def.memory !== 'object') {
            def.memory = {};
          }
          const t = def.memory as Record<string, unknown>;
          if (p.enabled !== undefined) {
            if (p.enabled === null) delete t.enabled;
            else t.enabled = Boolean(p.enabled);
          }
          if (p.useEnhancedSystem !== undefined) {
            if (p.useEnhancedSystem === null) delete t.useEnhancedSystem;
            else t.useEnhancedSystem = Boolean(p.useEnhancedSystem);
          }
          if (p.userProfileEnabled !== undefined) {
            if (p.userProfileEnabled === null) delete t.userProfileEnabled;
            else t.userProfileEnabled = Boolean(p.userProfileEnabled);
          }
          if (p.memoryCharLimit !== undefined) {
            if (p.memoryCharLimit === null) delete t.memoryCharLimit;
            else if (typeof p.memoryCharLimit === 'number' && p.memoryCharLimit > 0) {
              t.memoryCharLimit = Math.floor(p.memoryCharLimit);
            }
          }
          if (p.userCharLimit !== undefined) {
            if (p.userCharLimit === null) delete t.userCharLimit;
            else if (typeof p.userCharLimit === 'number' && p.userCharLimit > 0) {
              t.userCharLimit = Math.floor(p.userCharLimit);
            }
          }
          if (p.provider === 'none' || p.provider === 'stub') {
            t.provider = p.provider;
          } else if (p.provider === null) {
            delete t.provider;
          }
          if (p.injectionFrequency === 'every-turn' || p.injectionFrequency === 'first-turn') {
            t.injectionFrequency = p.injectionFrequency;
          } else if (p.injectionFrequency === null) {
            delete t.injectionFrequency;
          }
          if (p.contextCadence !== undefined) {
            if (p.contextCadence === null) delete t.contextCadence;
            else if (typeof p.contextCadence === 'number' && p.contextCadence >= 1) {
              t.contextCadence = Math.floor(p.contextCadence);
            }
          }
          if (p.dialecticCadence !== undefined) {
            if (p.dialecticCadence === null) delete t.dialecticCadence;
            else if (typeof p.dialecticCadence === 'number' && p.dialecticCadence >= 1) {
              t.dialecticCadence = Math.floor(p.dialecticCadence);
            }
          }

          // Dreaming (schemaless patch): agents.defaults.memory.dreaming
          if (p.dreaming !== undefined) {
            const d0 = p.dreaming;
            if (d0 === null) {
              delete (t as { dreaming?: unknown }).dreaming;
            } else if (typeof d0 === 'object' && d0 !== null && !Array.isArray(d0)) {
              if (!('dreaming' in t) || typeof (t as { dreaming?: unknown }).dreaming !== 'object') {
                (t as { dreaming?: Record<string, unknown> }).dreaming = {};
              }
              const dt = (t as { dreaming: Record<string, unknown> }).dreaming;
              const dp = d0 as Record<string, unknown>;

              if (dp.enabled !== undefined) {
                if (dp.enabled === null) delete dt.enabled;
                else dt.enabled = Boolean(dp.enabled);
              }
              if (dp.frequency !== undefined) {
                const v = dp.frequency;
                if (v === null || v === '') delete dt.frequency;
                else if (typeof v === 'string') dt.frequency = v;
              }
              if (dp.timezone !== undefined) {
                const v = dp.timezone;
                if (v === null || v === '') delete dt.timezone;
                else if (typeof v === 'string') dt.timezone = v;
              }

              // Accept either `phases.deep` or `deep`.
              if (dp.phases !== undefined || dp.deep !== undefined) {
                if (!('phases' in dt) || typeof (dt as { phases?: unknown }).phases !== 'object' || (dt as { phases?: unknown }).phases === null) {
                  dt.phases = {};
                }
                const phases = (dt as { phases: Record<string, unknown> }).phases;
                if (!('deep' in phases) || typeof phases.deep !== 'object' || phases.deep === null) {
                  phases.deep = {};
                }
                const deep = phases.deep as Record<string, unknown>;

                const deepPatchRaw =
                  typeof dp.phases === 'object' && dp.phases !== null && !Array.isArray(dp.phases)
                    ? (dp.phases as Record<string, unknown>).deep
                    : dp.deep;
                const deepPatch =
                  typeof deepPatchRaw === 'object' && deepPatchRaw !== null && !Array.isArray(deepPatchRaw)
                    ? (deepPatchRaw as Record<string, unknown>)
                    : null;

                if (deepPatch) {
                  if (deepPatch.enabled !== undefined) {
                    if (deepPatch.enabled === null) delete deep.enabled;
                    else deep.enabled = Boolean(deepPatch.enabled);
                  }
                  if (deepPatch.minScore !== undefined) {
                    const v = deepPatch.minScore;
                    if (v === null) delete deep.minScore;
                    else if (typeof v === 'number' && Number.isFinite(v)) deep.minScore = v;
                  }
                  if (deepPatch.minRecallCount !== undefined) {
                    const v = deepPatch.minRecallCount;
                    if (v === null) delete deep.minRecallCount;
                    else if (typeof v === 'number' && Number.isFinite(v)) deep.minRecallCount = Math.floor(v);
                  }
                  if (deepPatch.limit !== undefined) {
                    const v = deepPatch.limit;
                    if (v === null) delete deep.limit;
                    else if (typeof v === 'number' && Number.isFinite(v)) deep.limit = Math.floor(v);
                  }
                }
              }
            }
          }
        }
      }

      if (dPatch.sessionSearch !== undefined) {
        const c = dPatch.sessionSearch;
        if (c === null) {
          delete def.sessionSearch;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.sessionSearch || typeof def.sessionSearch !== 'object') {
            def.sessionSearch = {};
          }
          const t = def.sessionSearch as Record<string, unknown>;
          if (p.summaryModel !== undefined) {
            if (p.summaryModel === null || p.summaryModel === '') {
              delete t.summaryModel;
            } else if (typeof p.summaryModel === 'string') {
              t.summaryModel = p.summaryModel;
            }
          }
        }
      }

      if (dPatch.backgroundReview !== undefined) {
        const c = dPatch.backgroundReview;
        if (c === null) {
          delete def.backgroundReview;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.backgroundReview || typeof def.backgroundReview !== 'object') {
            def.backgroundReview = {};
          }
          const t = def.backgroundReview as Record<string, unknown>;
          if (p.enabled !== undefined) {
            if (p.enabled === null) delete t.enabled;
            else t.enabled = Boolean(p.enabled);
          }
          if (p.memoryNudgeInterval !== undefined) {
            if (p.memoryNudgeInterval === null) delete t.memoryNudgeInterval;
            else if (typeof p.memoryNudgeInterval === 'number' && p.memoryNudgeInterval >= 0) {
              t.memoryNudgeInterval = Math.floor(p.memoryNudgeInterval);
            }
          }
          if (p.skillNudgeInterval !== undefined) {
            if (p.skillNudgeInterval === null) delete t.skillNudgeInterval;
            else if (typeof p.skillNudgeInterval === 'number' && p.skillNudgeInterval >= 0) {
              t.skillNudgeInterval = Math.floor(p.skillNudgeInterval);
            }
          }
          if (p.maxToolRounds !== undefined) {
            if (p.maxToolRounds === null) delete t.maxToolRounds;
            else if (typeof p.maxToolRounds === 'number' && p.maxToolRounds >= 1 && p.maxToolRounds <= 32) {
              t.maxToolRounds = Math.floor(p.maxToolRounds);
            }
          }
          if (p.maxHistoryMessages !== undefined) {
            if (p.maxHistoryMessages === null) delete t.maxHistoryMessages;
            else if (typeof p.maxHistoryMessages === 'number' && p.maxHistoryMessages >= 10 && p.maxHistoryMessages <= 200) {
              t.maxHistoryMessages = Math.floor(p.maxHistoryMessages);
            }
          }
          if (p.maxDurationMs !== undefined) {
            if (p.maxDurationMs === null) delete t.maxDurationMs;
            else if (typeof p.maxDurationMs === 'number' && p.maxDurationMs >= 30_000 && p.maxDurationMs <= 600_000) {
              t.maxDurationMs = Math.floor(p.maxDurationMs);
            }
          }
        }
      }

      if (dPatch.webExtract !== undefined) {
        const c = dPatch.webExtract;
        if (c === null) {
          delete def.webExtract;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.webExtract || typeof def.webExtract !== 'object') {
            def.webExtract = {};
          }
          const t = def.webExtract as Record<string, unknown>;
          if (p.model !== undefined) {
            if (p.model === null || p.model === '') {
              delete t.model;
            } else if (typeof p.model === 'string') {
              t.model = p.model;
            }
          }
          if (p.maxLength !== undefined) {
            if (p.maxLength === null) delete t.maxLength;
            else if (typeof p.maxLength === 'number' && p.maxLength > 0) {
              t.maxLength = p.maxLength;
            }
          }
        }
      }

      if (dPatch.delegate !== undefined) {
        const c = dPatch.delegate;
        if (c === null) {
          delete def.delegate;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.delegate || typeof def.delegate !== 'object') {
            def.delegate = {};
          }
          const t = def.delegate as Record<string, unknown>;
          if (p.enabled !== undefined) {
            if (p.enabled === null) delete t.enabled;
            else t.enabled = Boolean(p.enabled);
          }
        }
      }

      if (dPatch.executeCode !== undefined) {
        const c = dPatch.executeCode;
        if (c === null) {
          delete def.executeCode;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.executeCode || typeof def.executeCode !== 'object') {
            def.executeCode = {};
          }
          const t = def.executeCode as Record<string, unknown>;
          if (p.enabled !== undefined) {
            if (p.enabled === null) delete t.enabled;
            else t.enabled = Boolean(p.enabled);
          }
        }
      }

      if (dPatch.systemPromptOverride !== undefined) {
        const v = dPatch.systemPromptOverride;
        if (v === null || v === '') {
          delete def.systemPromptOverride;
        } else if (typeof v === 'string') {
          def.systemPromptOverride = v;
        }
      }

      if (dPatch.skills !== undefined) {
        const v = dPatch.skills;
        if (v === null) {
          delete def.skills;
        } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          def.skills = v;
        }
      }

      if (dPatch.tools !== undefined) {
        const t0 = dPatch.tools;
        if (t0 === null) {
          delete def.tools;
        } else if (typeof t0 === 'object' && !Array.isArray(t0)) {
          const p = t0 as { disable?: unknown };
          if (!def.tools || typeof def.tools !== 'object') {
            def.tools = {};
          }
          const t = def.tools as { disable?: string[] };
          if (p.disable !== undefined) {
            if (p.disable === null || (Array.isArray(p.disable) && p.disable.length === 0)) {
              delete t.disable;
            } else if (Array.isArray(p.disable) && p.disable.every((x) => typeof x === 'string')) {
              t.disable = p.disable;
            }
          }
        }
      }

      if (dPatch.params !== undefined) {
        const v = dPatch.params;
        if (v === null) {
          delete def.params;
        } else if (typeof v === 'object' && !Array.isArray(v) && v !== null) {
          def.params = v as Record<string, unknown>;
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
              dmPolicy: 'pairing',
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
          if (fs.appSecret !== undefined) fsTarget.appSecret = fs.appSecret;
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
    
    // Update gateway heartbeat (partial merge)
    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      if (!config.gateway) {
        config.gateway = {
          host: '0.0.0.0',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: ['*'],
        };
      }
      if (!config.gateway.heartbeat) {
        config.gateway.heartbeat = { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false };
      }
      const h = config.gateway.heartbeat;
      const p = body.gateway.heartbeat as Record<string, unknown>;
      if (p.enabled !== undefined) h.enabled = Boolean(p.enabled);
      if (p.intervalMs !== undefined && typeof p.intervalMs === 'number' && Number.isFinite(p.intervalMs)) {
        h.intervalMs = p.intervalMs;
      }
      if (p.includeSystemPromptSection !== undefined) {
        h.includeSystemPromptSection = Boolean(p.includeSystemPromptSection);
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
      if (!config.gateway) {
        config.gateway = {
          host: '0.0.0.0',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: ['*'],
        };
      }
      if (!config.gateway.auth) config.gateway.auth = { mode: 'token' };
      const a = body.gateway.auth;
      if (a.mode !== undefined) {
        config.gateway.auth.mode = a.mode;
      }
      if (a.token !== undefined) {
        config.gateway.auth.token = a.token;
      }
    }

    if (body.update !== undefined && typeof body.update === 'object' && body.update !== null) {
      const p = body.update as Record<string, unknown>;
      if (p.channel === 'stable' || p.channel === 'beta' || p.channel === 'dev') {
        if (!config.update) {
          config.update = { checkOnStart: true, channel: p.channel };
        } else {
          config.update.channel = p.channel;
        }
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
