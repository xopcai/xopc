/**
 * `PATCH /api/config` — `body.agents.defaults.*` section.
 *
 * Mutates `config.agents.defaults` in place to match the patch body. All
 * branches are field-by-field "if undefined skip, if null delete, else
 * coerce/validate then assign" so the web UI can clear individual settings
 * with `{ field: null }` without rewriting the rest.
 *
 * Was 660 lines inlined in `config.ts` (40% of the route handler) — extracted
 * so the dispatcher can chain section patchers instead of being a single 1600
 * -line if-else cascade.
 *
 * **No early returns / errors.** This section never rejects the patch; out-of
 * -range numbers and unrecognized strings are silently dropped (preserves
 * pre-extraction behavior so the route stays a "best-effort merge").
 */
import type { Config } from '../../../../config/schema.js';
import { isMaskedSecretPatchValue } from '../../lib/mask-secret-length.js';
import {
  normalizePatchAgentImageGenerationModel,
  normalizePatchAgentModel,
  normalizePatchTypedModels,
} from '../../lib/agent-model.js';

export function applyAgentsPatch(config: Config, body: any): void {
  if (!body.agents?.defaults) return;

  if (!config.agents) config.agents = { defaults: { workspace: '~/.xopc/workspace', model: { primary: 'anthropic/claude-sonnet-4-5' }, maxTokens: 8192, temperature: 0.7, maxToolIterations: 20, maxRequestsPerTurn: 50, maxToolFailuresPerTurn: 3, thinkingDefault: 'medium', reasoningDefault: 'stream', verboseDefault: 'full' } };
  if (!config.agents.defaults) config.agents.defaults = {} as any;

  if (body.agents.defaults.model !== undefined) {
    const v = body.agents.defaults.model;
    if (v === null) {
      delete (config.agents.defaults as Record<string, unknown>).model;
    } else {
      const normalized = normalizePatchAgentModel(v);
      if (normalized === undefined) {
        delete (config.agents.defaults as Record<string, unknown>).model;
      } else {
        config.agents.defaults.model = normalized as Config['agents']['defaults']['model'];
      }
    }
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
    if (v === null) {
      delete (config.agents.defaults as Record<string, unknown>).imageModel;
    } else {
      const normalized = normalizePatchAgentModel(v);
      if (normalized === undefined) {
        delete (config.agents.defaults as Record<string, unknown>).imageModel;
      } else {
        config.agents.defaults.imageModel = normalized as Config['agents']['defaults']['imageModel'];
      }
    }
  }
  if (body.agents.defaults.imageGenerationModel !== undefined) {
    const v = body.agents.defaults.imageGenerationModel;
    if (v === null) {
      delete (config.agents.defaults as Record<string, unknown>).imageGenerationModel;
    } else {
      const normalized = normalizePatchAgentImageGenerationModel(v);
      if (normalized === undefined) {
        delete (config.agents.defaults as Record<string, unknown>).imageGenerationModel;
      } else {
        config.agents.defaults.imageGenerationModel =
          normalized as Config['agents']['defaults']['imageGenerationModel'];
      }
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
        config.agents.defaults.browser = { enabled: false, headless: false };
      }
      const target = config.agents.defaults.browser as Record<string, unknown>;
      if (br.enabled !== undefined) {
        if (br.enabled === null) delete target.enabled;
        else target.enabled = Boolean(br.enabled);
      }
      if (br.headless !== undefined) {
        if (br.headless === null) delete target.headless;
        else target.headless = Boolean(br.headless);
      }
      if (br.allowPrivateUrls !== undefined) {
        if (br.allowPrivateUrls === null) delete target.allowPrivateUrls;
        else target.allowPrivateUrls = Boolean(br.allowPrivateUrls);
      }
      if (br.commandTimeout !== undefined) {
        if (br.commandTimeout === null) {
          delete target.commandTimeout;
        } else if (typeof br.commandTimeout === 'number' && Number.isFinite(br.commandTimeout)) {
          const n = Math.floor(br.commandTimeout);
          if (n >= 5 && n <= 900) {
            target.commandTimeout = n;
          }
        }
      }
      if (br.backend !== undefined) {
        if (br.backend === null || br.backend === '' || br.backend === 'extension') {
          delete target.backend;
        } else if (
          br.backend === 'local' ||
          br.backend === 'cdp' ||
          br.backend === 'cloud' ||
          br.backend === 'cloakbrowser'
        ) {
          target.backend = br.backend;
        }
      }
      if (br.cloudProvider !== undefined) {
        if (br.cloudProvider === null || br.cloudProvider === '') {
          delete target.cloudProvider;
        } else if (br.cloudProvider === 'browserbase' || br.cloudProvider === 'browser-use') {
          target.cloudProvider = br.cloudProvider;
        }
      }
      if (br.cloud !== undefined) {
        if (br.cloud === null) {
          delete target.cloud;
        } else if (typeof br.cloud === 'object' && !Array.isArray(br.cloud)) {
          const cloudPatch = br.cloud as Record<string, unknown>;
          const existingCloud =
            target.cloud && typeof target.cloud === 'object' && !Array.isArray(target.cloud)
              ? (target.cloud as Record<string, unknown>)
              : {};
          const cloudTarget: Record<string, unknown> = { ...existingCloud };
          if (cloudPatch.apiKey !== undefined) {
            if (cloudPatch.apiKey === null || cloudPatch.apiKey === '') {
              delete cloudTarget.apiKey;
            } else if (isMaskedSecretPatchValue(String(cloudPatch.apiKey))) {
              // Keep the existing stored key when the web UI sends the masked sentinel.
            } else if (typeof cloudPatch.apiKey === 'string') {
              cloudTarget.apiKey = cloudPatch.apiKey.trim();
            }
          }
          for (const key of ['projectId', 'region']) {
            const value = cloudPatch[key];
            if (value === null || value === '') {
              delete cloudTarget[key];
            } else if (typeof value === 'string' && value.trim()) {
              cloudTarget[key] = value.trim();
            }
          }
          if (Object.keys(cloudTarget).length > 0) {
            target.cloud = cloudTarget;
          } else {
            delete target.cloud;
          }
        }
      }
      if (br.cdpUrl !== undefined) {
        if (br.cdpUrl === null || br.cdpUrl === '') {
          delete target.cdpUrl;
        } else if (typeof br.cdpUrl === 'string') {
          target.cdpUrl = br.cdpUrl.trim();
        }
      }
      if (br.extension !== undefined) {
        if (br.extension === null) {
          delete target.extension;
        } else if (typeof br.extension === 'object' && !Array.isArray(br.extension)) {
          const ext = br.extension as Record<string, unknown>;
          const extTarget: Record<string, unknown> = {};
          if (ext.port === null || ext.port === '') {
            // explicit clear: leave unset (consumers fall back to default)
          } else if (typeof ext.port === 'number' && ext.port >= 1024 && ext.port <= 65535) {
            extTarget.port = Math.floor(ext.port);
          }
          if (ext.host === null || ext.host === '') {
            // explicit clear
          } else if (typeof ext.host === 'string' && ext.host.trim()) {
            extTarget.host = ext.host.trim();
          }
          if (
            ext.connectionTimeout === null ||
            ext.connectionTimeout === ''
          ) {
            // explicit clear
          } else if (
            typeof ext.connectionTimeout === 'number' &&
            Number.isFinite(ext.connectionTimeout) &&
            ext.connectionTimeout >= 1000
          ) {
            extTarget.connectionTimeout = Math.floor(ext.connectionTimeout);
          }
          if (Object.keys(extTarget).length > 0) {
            target.extension = extTarget;
          } else {
            delete target.extension;
          }
        }
      }
      if (br.cloakbrowser !== undefined) {
        if (br.cloakbrowser === null) {
          delete target.cloakbrowser;
        } else if (typeof br.cloakbrowser === 'object' && !Array.isArray(br.cloakbrowser)) {
          const cloakbrowserPatch = br.cloakbrowser as Record<string, unknown>;
          const cloakbrowserTarget: Record<string, unknown> = {};
          if (typeof cloakbrowserPatch.keepOpen === 'boolean') {
            cloakbrowserTarget.keepOpen = cloakbrowserPatch.keepOpen;
          }
          if (typeof cloakbrowserPatch.temporaryProfile === 'boolean') {
            cloakbrowserTarget.temporaryProfile = cloakbrowserPatch.temporaryProfile;
          }
          for (const key of ['cacheDir', 'binaryPath', 'timezone', 'locale', 'webrtcIp', 'fingerprintPlatform']) {
            const value = cloakbrowserPatch[key];
            if (typeof value === 'string' && value.trim()) {
              cloakbrowserTarget[key] = value.trim();
            }
          }
          if (
            Array.isArray(cloakbrowserPatch.extraArgs) &&
            cloakbrowserPatch.extraArgs.every((value) => typeof value === 'string')
          ) {
            cloakbrowserTarget.extraArgs = cloakbrowserPatch.extraArgs;
          }
          if (Object.keys(cloakbrowserTarget).length > 0) {
            target.cloakbrowser = cloakbrowserTarget;
          } else {
            delete target.cloakbrowser;
          }
        }
      }
      if (br.humanize !== undefined) {
        if (br.humanize === null) {
          delete target.humanize;
        } else {
          target.humanize = Boolean(br.humanize);
        }
      }
      if (br.humanPreset !== undefined) {
        if (br.humanPreset === null) {
          delete target.humanPreset;
        } else if (br.humanPreset === 'default' || br.humanPreset === 'careful') {
          target.humanPreset = br.humanPreset;
        }
      }
      if (br.dialogPolicy !== undefined) {
        if (br.dialogPolicy === null) {
          delete target.dialogPolicy;
        } else if (
          br.dialogPolicy === 'must_respond' ||
          br.dialogPolicy === 'auto_dismiss' ||
          br.dialogPolicy === 'auto_accept'
        ) {
          target.dialogPolicy = br.dialogPolicy;
        }
      }
      if (br.dialogTimeoutSeconds !== undefined) {
        if (br.dialogTimeoutSeconds === null) {
          delete target.dialogTimeoutSeconds;
        } else if (typeof br.dialogTimeoutSeconds === 'number' && Number.isFinite(br.dialogTimeoutSeconds)) {
          const n = Math.floor(br.dialogTimeoutSeconds);
          if (n >= 1 && n <= 86_400) {
            target.dialogTimeoutSeconds = n;
          }
        }
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

  if (dPatch.models !== undefined) {
    const normalized = normalizePatchTypedModels(dPatch.models);
    if (normalized === undefined) {
      // skip invalid shape
    } else if (normalized === null) {
      delete def.models;
    } else {
      def.models = normalized;
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
