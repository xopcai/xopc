import { createHash } from 'node:crypto';

import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { buildCapabilityPlansForConfig } from '../capabilities/readiness/from-config.js';
import type { Config } from '../config/schema.js';
import { getPersonalAgent } from '../personal-agent/repository.js';
import { getConfiguredProviders } from '../providers/index.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { readUserAvatar } from '../user-context/user-avatar.js';
import type {
  SelfConfigDomain,
  SelfConfigDomainStatus,
  SelfConfigInspectResult,
} from './types.js';

export interface InspectSelfConfigOptions {
  domain?: SelfConfigDomain;
  ownerId?: string;
}

const ALL_DOMAINS: readonly Exclude<SelfConfigDomain, 'all'>[] = [
  'models',
  'voice',
  'web_search',
  'channels',
  'browser',
  'phone',
  'computer',
  'profile',
  'appearance',
  'compaction',
];

function safeAgentCatalogSnapshot(): ReturnType<AgentCatalogRepository['snapshot']> | null {
  try {
    if (!isXopcDatabaseOpen()) return null;
    return new AgentCatalogRepository().snapshot();
  } catch {
    return null;
  }
}

function safeCapabilityPlans(config: Config) {
  try {
    return buildCapabilityPlansForConfig(config);
  } catch {
    return null;
  }
}

function summarizeChannel(raw: unknown): {
  enabled: boolean;
  accountCount: number;
  dmPolicy?: string;
  groupPolicy?: string;
  hasCredential: boolean;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { enabled: false, accountCount: 0, hasCredential: false };
  }
  const channel = raw as Record<string, unknown>;
  const enabled = channel.enabled === true;
  const accounts = channel.accounts && typeof channel.accounts === 'object' && !Array.isArray(channel.accounts)
    ? Object.values(channel.accounts as Record<string, Record<string, unknown>>)
    : [];
  const hasTopToken = typeof channel.botToken === 'string' && channel.botToken.trim().length > 0;
  const hasAccountToken = accounts.some(
    (acc) => typeof acc?.botToken === 'string' && acc.botToken.trim().length > 0,
  );
  const firstAcc = accounts[0];
  return {
    enabled,
    accountCount: accounts.length,
    dmPolicy: typeof firstAcc?.dmPolicy === 'string'
      ? firstAcc.dmPolicy
      : typeof channel.dmPolicy === 'string'
        ? channel.dmPolicy
        : undefined,
    groupPolicy: typeof firstAcc?.groupPolicy === 'string'
      ? firstAcc.groupPolicy
      : typeof channel.groupPolicy === 'string'
        ? channel.groupPolicy
        : undefined,
    hasCredential: hasTopToken || hasAccountToken,
  };
}

/**
 * Produces a strictly redacted, non-secret self-inspection snapshot across xopc settings domains.
 * Never returns API keys, tokens, passwords, or raw credential bytes.
 */
export async function inspectSelfConfig(
  config: Config,
  options: InspectSelfConfigOptions = {},
): Promise<SelfConfigInspectResult> {
  const requestedDomain: SelfConfigDomain = options.domain ?? 'all';
  const catalog = safeAgentCatalogSnapshot();
  const plans = safeCapabilityPlans(config);
  const configuredProviders = await (async (): Promise<string[]> => {
    try {
      return await getConfiguredProviders();
    } catch {
      return [];
    }
  })();

  const userAvatar = await readUserAvatar();
  const personalRecord = (() => {
    try {
      return isXopcDatabaseOpen() ? getPersonalAgent(options.ownerId ?? 'local-owner') : null;
    } catch {
      return null;
    }
  })();

  const buildDomain = (domain: Exclude<SelfConfigDomain, 'all'>): SelfConfigDomainStatus => {
    switch (domain) {
      case 'models': {
        const models = catalog?.defaults.models;
        const chatPrimary = models?.chat?.primary;
        const imageGenPlan = plans?.['image-generation'];
        const visionPlan = plans?.vision;
        const blockers: string[] = [];
        if (configuredProviders.length === 0) {
          blockers.push('No LLM provider credentials configured.');
        }
        if (!chatPrimary) {
          blockers.push('Default chat model is not configured.');
        }
        if (imageGenPlan && imageGenPlan.status !== 'ready') {
          blockers.push('Image generation model is not ready.');
        }
        return {
          domain: 'models',
          configured: configuredProviders.length > 0 || Boolean(chatPrimary),
          ready: configuredProviders.length > 0 && Boolean(chatPrimary),
          blockers,
          summary: chatPrimary
            ? `Default chat model: ${chatPrimary}; configured providers: ${configuredProviders.length}.`
            : `No default chat model set; configured providers: ${configuredProviders.length}.`,
          details: {
            configuredProviders,
            defaults: {
              chat: models?.chat?.primary ?? null,
              fast: models?.intents?.fast?.primary ?? null,
              vision: models?.intents?.vision?.primary ?? null,
              imageGeneration: models?.imageGeneration?.primary ?? null,
              computerUse: models?.computerUse?.primary ?? null,
              phoneUse: models?.phoneUse?.primary ?? null,
            },
            readiness: {
              vision: visionPlan?.status ?? 'unknown',
              imageGeneration: imageGenPlan?.status ?? 'unknown',
            },
          },
          settingsSection: 'capabilities/models',
          setupScene: 'models',
          ...(blockers.length > 0
            ? { nextAction: 'Run xopc_use({ mode: "setup", command: "start", args: { scene: "models" } }) to configure provider keys or default models.' }
            : {}),
        };
      }

      case 'voice': {
        const tts = config.messages?.tts;
        const stt = config.tools?.media?.audio;
        const ttsPlan = plans?.tts;
        const sttPlan = plans?.stt;
        const ttsEnabled = tts?.enabled !== false;
        const sttEnabled = stt?.enabled === true;
        const blockers: string[] = [];
        if (ttsPlan && ttsEnabled && ttsPlan.status !== 'ready') {
          blockers.push(`TTS provider (${tts?.provider ?? 'edge'}) is not ready.`);
        }
        if (sttPlan && sttEnabled && sttPlan.status !== 'ready') {
          blockers.push(`STT provider (${stt?.provider ?? 'openai'}) is not ready.`);
        }
        const ready = (ttsEnabled && (ttsPlan?.status === 'ready' || (tts?.provider ?? 'edge') === 'edge'))
          || (sttEnabled && sttPlan?.status === 'ready');
        return {
          domain: 'voice',
          configured: ttsEnabled || sttEnabled,
          ready,
          blockers,
          summary: `TTS ${ttsEnabled ? `enabled (${tts?.provider ?? 'edge'}, trigger=${tts?.trigger ?? 'off'})` : 'disabled'}; STT ${sttEnabled ? `enabled (${stt?.provider ?? 'openai'})` : 'disabled'}.`,
          details: {
            tts: {
              enabled: ttsEnabled,
              provider: tts?.provider ?? 'edge',
              trigger: tts?.trigger ?? 'off',
              maxTextLength: tts?.maxTextLength ?? 512,
              voice: tts?.providers?.[tts?.provider ?? 'edge']?.voice ?? null,
              readiness: ttsPlan?.status ?? 'unknown',
            },
            stt: {
              enabled: sttEnabled,
              provider: stt?.provider ?? 'openai',
              readiness: sttPlan?.status ?? 'unknown',
            },
          },
          settingsSection: 'capabilities/voice',
          setupScene: 'voice',
          ...(blockers.length > 0
            ? { nextAction: 'Run xopc_use({ mode: "setup", command: "start", args: { scene: "voice" } }) to configure TTS/STT providers.' }
            : {}),
        };
      }

      case 'web_search': {
        const web = config.tools?.web;
        const providers = (web?.search?.providers ?? []).map((entry) => ({
          type: entry.type,
          disabled: entry.disabled === true,
          hasApiKey: typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0,
          hasUrl: typeof entry.url === 'string' && entry.url.trim().length > 0,
        }));
        const activeManual = providers.filter(
          (p) => !p.disabled && (p.type === 'searxng' ? p.hasUrl : p.hasApiKey),
        );
        const blockers: string[] = [];
        if (activeManual.length === 0) {
          blockers.push('No manual search provider API key configured (falling back to HTML search).');
        }
        return {
          domain: 'web_search',
          configured: activeManual.length > 0,
          ready: true,
          blockers,
          summary: activeManual.length > 0
            ? `Configured search providers: ${activeManual.map((p) => p.type).join(', ')} (maxResults=${web?.search?.maxResults ?? 5}).`
            : `No dedicated search API configured; using region=${web?.region ?? 'global'} HTML fallback.`,
          details: {
            region: web?.region ?? 'global',
            maxResults: web?.search?.maxResults ?? 5,
            providers,
          },
          settingsSection: 'capabilities/web-search',
          setupScene: 'web_search',
          ...(blockers.length > 0
            ? { nextAction: 'Run xopc_use({ mode: "setup", command: "start", args: { scene: "web_search" } }) to add a Brave, Tavily, Bing, DeepSeek, or SearXNG search provider.' }
            : {}),
        };
      }

      case 'channels': {
        const telegram = summarizeChannel(config.channels?.telegram);
        const weixin = summarizeChannel(config.channels?.weixin);
        const configured = telegram.enabled || weixin.enabled;
        const blockers: string[] = [];
        if (telegram.enabled && !telegram.hasCredential && !process.env.TELEGRAM_BOT_TOKEN) {
          blockers.push('Telegram is enabled without a bot token.');
        }
        return {
          domain: 'channels',
          configured,
          ready: configured && blockers.length === 0,
          blockers,
          summary: `Telegram: ${telegram.enabled ? 'enabled' : 'disabled'}; Weixin: ${weixin.enabled ? 'enabled' : 'disabled'}.`,
          details: { telegram, weixin },
          settingsSection: 'channels',
          setupScene: 'channels',
          ...(!configured || blockers.length > 0
            ? { nextAction: 'Run xopc_use({ mode: "setup", command: "start", args: { scene: "channels" } }) to connect Telegram or Weixin.' }
            : {}),
        };
      }

      case 'browser': {
        const enabled = config.browser?.enabled === true;
        const driverKind = config.browser?.driver?.kind ?? 'extension';
        const blockers = enabled ? [] : ['Browser Use is disabled in configuration.'];
        return {
          domain: 'browser',
          configured: enabled,
          ready: enabled,
          blockers,
          summary: `Browser Use ${enabled ? `enabled (driver=${driverKind})` : 'disabled'}.`,
          details: {
            enabled,
            driverKind,
          },
          settingsSection: 'agent-browser',
          setupScene: 'browser',
          ...(blockers.length > 0
            ? { nextAction: 'Run xopc_use({ mode: "browser_setup", command: "inspect" }) or mode "setup" with scene "browser".' }
            : {}),
        };
      }

      case 'phone': {
        const enabled = config.phone?.enabled === true;
        const blockers = enabled ? [] : ['Phone Use is disabled in configuration.'];
        return {
          domain: 'phone',
          configured: enabled,
          ready: enabled,
          blockers,
          summary: `Phone Use ${enabled ? 'enabled' : 'disabled'}.`,
          details: {
            enabled,
            model: catalog?.defaults.models.phoneUse?.primary ?? null,
          },
          settingsSection: 'agent-phone',
          setupScene: 'phone',
          ...(blockers.length > 0
            ? { nextAction: 'Run xopc_use({ mode: "phone_setup", command: "inspect" }) or mode "setup" with scene "phone".' }
            : {}),
        };
      }

      case 'computer': {
        const enabled = config.computer?.enabled === true;
        const plan = plans?.['computer-use'];
        const blockers: string[] = [];
        if (!enabled) blockers.push('Computer Use is disabled in configuration.');
        if (enabled && plan && plan.status !== 'ready') {
          blockers.push('Computer Use model is not ready.');
        }
        return {
          domain: 'computer',
          configured: enabled,
          ready: enabled && (plan?.status === 'ready' || Boolean(catalog?.defaults.models.computerUse?.primary)),
          blockers,
          summary: `Computer Use ${enabled ? 'enabled' : 'disabled'}; model=${catalog?.defaults.models.computerUse?.primary ?? 'none'}.`,
          details: {
            enabled,
            model: catalog?.defaults.models.computerUse?.primary ?? null,
            readiness: plan?.status ?? 'unknown',
          },
          settingsSection: 'agent-computer',
          setupScene: 'computer',
          ...(blockers.length > 0
            ? { nextAction: 'Run xopc_use({ mode: "setup", command: "start", args: { scene: "computer" } }) to enable Computer Use and verify OS permissions.' }
            : {}),
        };
      }

      case 'profile': {
        return {
          domain: 'profile',
          configured: userAvatar.ok || Boolean(personalRecord),
          ready: true,
          blockers: [],
          summary: `User avatar: ${userAvatar.ok ? `set (${userAvatar.data.contentType})` : 'not set'}; Personal AI: ${personalRecord ? `${personalRecord.displayName} (${personalRecord.appearance})` : 'not initialized'}.`,
          details: {
            userAvatar: {
              configured: userAvatar.ok,
              contentType: userAvatar.ok ? userAvatar.data.contentType : null,
            },
            defaultAgentId: catalog?.defaultAgentId ?? 'main',
            personalAgent: personalRecord
              ? {
                  agentId: personalRecord.agentId,
                  displayName: personalRecord.displayName,
                  appearance: personalRecord.appearance,
                  state: personalRecord.state,
                  revision: personalRecord.revision,
                  messageReactionsEnabled: personalRecord.messageReactionsEnabled ?? null,
                  hasVoicePreference: Boolean(personalRecord.voicePreference),
                }
              : null,
          },
          settingsSection: 'personal',
        };
      }

      case 'appearance': {
        const activityDetailDefault = config.gateway?.webchat?.activityDetailDefault ?? 'on';
        return {
          domain: 'appearance',
          configured: true,
          ready: true,
          blockers: [],
          summary: `Webchat activity detail default: ${activityDetailDefault}.`,
          details: {
            activityDetailDefault,
            userAvatarConfigured: userAvatar.ok,
          },
          settingsSection: 'appearance',
        };
      }

      case 'compaction': {
        const compaction = config.userContext?.contextPlanning?.compaction;
        const enabled = compaction?.enabled !== false;
        return {
          domain: 'compaction',
          configured: true,
          ready: true,
          blockers: [],
          summary: `Context compaction ${enabled ? `enabled (trigger=${compaction?.triggerThreshold ?? 0.8}, preserve=${compaction?.recentTurnsPreserve ?? 3} turns)` : 'disabled'}.`,
          details: {
            enabled,
            triggerThreshold: compaction?.triggerThreshold ?? 0.8,
            recentTurnsPreserve: compaction?.recentTurnsPreserve ?? 3,
            keepRecentTokens: compaction?.keepRecentTokens ?? 20_000,
            qualityGuard: compaction?.qualityGuard ?? true,
          },
          settingsSection: 'session',
        };
      }
    }
  };

  const targetDomains = requestedDomain === 'all' ? ALL_DOMAINS : [requestedDomain];
  const domains = targetDomains.map(buildDomain);
  const blockers = domains.flatMap((entry) =>
    entry.blockers.map((reason) => ({
      domain: entry.domain,
      reason,
      ...(entry.setupScene ? { setupScene: entry.setupScene } : {}),
      ...(entry.nextAction ? { nextAction: entry.nextAction } : {}),
    })),
  );
  const revision = createHash('sha256')
    .update(JSON.stringify(domains))
    .digest('hex');

  return {
    ok: true,
    revision,
    domain: requestedDomain,
    domains,
    blockers,
    summary: blockers.length === 0
      ? `Inspected ${domains.length} domain(s): all ready.`
      : `Inspected ${domains.length} domain(s): ${blockers.length} item(s) need attention.`,
  };
}
