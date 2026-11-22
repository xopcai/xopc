import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { CredentialResolver } from '../auth/credentials.js';
import { ConfigSchema, type Config } from '../config/schema.js';
import { inspectSelfConfig } from './inspect.js';
import type {
  ManagedSetupSceneId,
  SelfConfigDomain,
  UnifiedSetupRun,
} from './types.js';

export const MANAGED_SETUP_SCENES: readonly ManagedSetupSceneId[] = [
  'models',
  'web_search',
  'voice',
  'channels',
  'computer',
] as const;

export function isManagedSetupScene(value: string): value is ManagedSetupSceneId {
  return (MANAGED_SETUP_SCENES as readonly string[]).includes(value);
}

const SCENE_TO_DOMAIN: Record<ManagedSetupSceneId, Exclude<SelfConfigDomain, 'all'>> = {
  models: 'models',
  web_search: 'web_search',
  voice: 'voice',
  channels: 'channels',
  computer: 'computer',
};

const SCENE_TO_SETTINGS_PATH: Record<ManagedSetupSceneId, string> = {
  models: '/settings/capabilities/models',
  web_search: '/settings/capabilities/web-search',
  voice: '/settings/capabilities/voice',
  channels: '/settings/channels',
  computer: '/settings/agent-computer',
};

const ModelsSecretSchema = z.strictObject({
  providerId: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().min(1).max(4096),
});

const WebSearchSecretSchema = z.strictObject({
  providerType: z.enum(['brave', 'tavily', 'bing', 'searxng', 'deepseek']),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  url: z.string().trim().url().max(1024).optional(),
}).refine(
  (v) => (v.providerType === 'searxng' ? Boolean(v.url) : Boolean(v.apiKey)),
  'SearXNG requires a URL; other providers require an API key.',
);

const VoiceSecretSchema = z.strictObject({
  capability: z.enum(['tts', 'stt']),
  provider: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  voice: z.string().trim().min(1).max(200).optional(),
  model: z.string().trim().min(1).max(200).optional(),
});

const ChannelsSecretSchema = z.strictObject({
  channel: z.enum(['telegram', 'weixin']),
  botToken: z.string().trim().min(1).max(4096).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).optional(),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).optional(),
});

const ComputerConfirmSchema = z.strictObject({
  enabled: z.boolean().default(true),
  permissionsConfirmed: z.boolean().optional(),
}).refine(
  (value) => !value.enabled || value.permissionsConfirmed === true,
  'Confirm the required permissions before enabling Computer Use.',
);

export interface UnifiedSetupSceneDeps {
  getConfig: () => Config | undefined;
  saveConfig?: (next: Config, expected?: Config) => Promise<{ saved: boolean; error?: string; conflict?: boolean }>;
  saveProviderApiKey?: (providerId: string, apiKey: string) => Promise<void>;
  emitEvent?: (event: string, payload: unknown) => void;
}

const MAX_RUNS = 200;

/**
 * Unified guided setup engine for models, web_search, voice, channels, and computer.
 * Keeps Tier-3 secrets strictly inside owner-authenticated HTTP modals (`POST /api/setup/:scene`),
 * never accepting credentials from LLM tool arguments.
 */
export class UnifiedSetupSceneService {
  private readonly runs = new Map<string, UnifiedSetupRun>();
  private readonly order: string[] = [];

  constructor(private readonly deps: UnifiedSetupSceneDeps) {}

  private put(run: UnifiedSetupRun): UnifiedSetupRun {
    this.runs.set(run.id, run);
    if (!this.order.includes(run.id)) {
      this.order.push(run.id);
      while (this.order.length > MAX_RUNS) {
        const oldest = this.order.shift();
        if (oldest) this.runs.delete(oldest);
      }
    }
    return { ...run };
  }

  private findActive(scene: ManagedSetupSceneId, conversationId: string, agentId: string): UnifiedSetupRun | undefined {
    for (let index = this.order.length - 1; index >= 0; index -= 1) {
      const id = this.order[index]!;
      const run = this.runs.get(id);
      if (
        run
        && run.scene === scene
        && run.conversationId === conversationId
        && run.agentId === agentId
        && run.state !== 'cancelled'
        && run.state !== 'completed'
      ) {
        return run;
      }
    }
    return undefined;
  }

  getOwned(setupId: string, conversationId: string): UnifiedSetupRun {
    const run = this.runs.get(setupId);
    if (!run || run.conversationId !== conversationId) {
      throw new Error('SETUP_NOT_FOUND');
    }
    return { ...run };
  }

  private async evaluateScene(scene: ManagedSetupSceneId) {
    const config = this.deps.getConfig();
    if (!config) {
      throw new Error('Host configuration is unavailable.');
    }
    const inspection = await inspectSelfConfig(config, { domain: SCENE_TO_DOMAIN[scene] });
    const status = inspection.domains[0]!;
    return { status, revision: inspection.revision };
  }

  async inspectScene(scene: ManagedSetupSceneId, context: { conversationId: string; agentId: string }) {
    const { status } = await this.evaluateScene(scene);
    const active = this.findActive(scene, context.conversationId, context.agentId);
    return {
      ok: true,
      scene,
      configured: status.configured,
      ready: status.ready,
      blockers: status.blockers,
      summary: status.summary,
      details: status.details,
      settingsPath: SCENE_TO_SETTINGS_PATH[scene],
      setup: active ? { ...active } : null,
      supportedActions: ['inspect', 'start', 'get', 'recheck', 'verify', 'cancel'],
    };
  }

  async command(
    scene: ManagedSetupSceneId,
    command: string,
    args: Record<string, unknown>,
    context: { conversationId: string; agentId: string; canConfigure?: boolean },
    dryRun = false,
  ): Promise<Record<string, unknown>> {
    if (command === 'inspect' || command === 'preview') {
      return this.inspectScene(scene, context);
    }
    if (dryRun) {
      const info = await this.inspectScene(scene, context);
      return { ...info, dryRun: true, message: 'No changes made.' };
    }

    if (command === 'start' && !context.canConfigure) {
      throw new Error('SETUP_INTERACTIVE_REQUIRED: Continue in an authorized interactive conversation.');
    }

    if (command === 'start') {
      const { status } = await this.evaluateScene(scene);
      const existing = this.findActive(scene, context.conversationId, context.agentId);
      const resumeObjective = typeof args.resumeObjective === 'string' && args.resumeObjective.trim()
        ? args.resumeObjective.trim().slice(0, 400)
        : existing?.resumeObjective;
      const target = this.extractTarget(args) ?? existing?.target;
      if (existing) {
        const updated: UnifiedSetupRun = {
          ...existing,
          revision: existing.revision + 1,
          resumeObjective,
          target,
          checks: { configured: status.configured, verified: existing.checks.verified },
          missingSteps: status.blockers,
          summary: status.summary,
          state: status.ready && status.blockers.length === 0 ? 'ready_to_verify' : 'needs_input',
          updatedAt: Date.now(),
        };
        return { ok: true, setup: this.put(updated) };
      }

      const id = randomUUID();
      const now = Date.now();
      const run: UnifiedSetupRun = {
        id,
        scene,
        conversationId: context.conversationId,
        agentId: context.agentId,
        revision: 1,
        state: status.ready && status.blockers.length === 0 ? 'ready_to_verify' : 'needs_input',
        ...(resumeObjective ? { resumeObjective } : {}),
        ...(target ? { target } : {}),
        checks: { configured: status.configured, verified: false },
        missingSteps: status.blockers,
        summary: status.summary,
        interactionPath: `/configuration/${scene}/${id}?conversationId=${encodeURIComponent(context.conversationId)}`,
        settingsPath: SCENE_TO_SETTINGS_PATH[scene],
        createdAt: now,
        updatedAt: now,
      };
      return { ok: true, setup: this.put(run) };
    }

    const setupId = typeof args.setupId === 'string' ? args.setupId.trim() : '';
    if (!setupId) {
      throw new Error('setupId is required');
    }
    const current = this.getOwned(setupId, context.conversationId);
    if (current.scene !== scene) {
      throw new Error(`Setup ${setupId} belongs to scene "${current.scene}", not "${scene}".`);
    }

    if (command === 'get') {
      return { ok: true, setup: current };
    }

    if (command === 'cancel') {
      const cancelled: UnifiedSetupRun = {
        ...current,
        revision: current.revision + 1,
        state: 'cancelled',
        updatedAt: Date.now(),
      };
      return { ok: true, setup: this.put(cancelled) };
    }

    if (command === 'recheck' || command === 'advance') {
      const { status } = await this.evaluateScene(scene);
      const nextState = current.state === 'cancelled'
        ? 'cancelled'
        : status.ready && status.blockers.length === 0
          ? 'ready_to_verify'
          : 'needs_input';
      const next: UnifiedSetupRun = {
        ...current,
        revision: current.revision + 1,
        state: nextState,
        checks: { configured: status.configured, verified: current.checks.verified && status.ready },
        missingSteps: status.blockers,
        summary: status.summary,
        error: undefined,
        updatedAt: Date.now(),
      };
      return { ok: true, setup: this.put(next) };
    }

    if (command === 'verify') {
      const { status } = await this.evaluateScene(scene);
      if (current.state === 'cancelled') {
        throw new Error('Cannot verify a cancelled setup.');
      }
      const verified = status.configured && status.ready && status.blockers.length === 0;
      const next: UnifiedSetupRun = {
        ...current,
        revision: current.revision + 1,
        state: verified ? 'completed' : 'needs_input',
        checks: { configured: status.configured, verified },
        missingSteps: status.blockers,
        summary: verified
          ? `Verified ${scene} setup: ready for use.`
          : `Verification incomplete for ${scene}: ${status.blockers.join(' ') || status.summary}`,
        error: verified ? undefined : status.blockers[0] ?? 'Configuration is not ready yet.',
        updatedAt: Date.now(),
      };
      return { ok: true, verified, setup: this.put(next) };
    }

    throw new Error(`Unsupported setup command "${command}" for scene "${scene}".`);
  }

  /**
   * Owner-authenticated HTTP endpoint handler for Tier-3 secret/permission submission.
   * Never callable from LLM tool arguments.
   */
  async submitSecureInput(
    scene: ManagedSetupSceneId,
    setupId: string,
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<UnifiedSetupRun> {
    const current = this.getOwned(setupId, conversationId);
    if (current.scene !== scene) {
      throw new Error('SETUP_SCENE_MISMATCH');
    }
    if (current.state === 'cancelled' || current.state === 'completed') {
      throw new Error('SETUP_CLOSED');
    }
    const config = this.deps.getConfig();
    if (!config) {
      throw new Error('Host configuration is unavailable.');
    }

    if (scene === 'models') {
      const parsed = ModelsSecretSchema.parse(payload);
      if (this.deps.saveProviderApiKey) {
        await this.deps.saveProviderApiKey(parsed.providerId, parsed.apiKey);
      } else {
        await new CredentialResolver().saveApiKey(parsed.providerId, parsed.apiKey, { profileName: 'default' });
      }
      this.deps.emitEvent?.('config.reload', { section: 'models', source: 'setup-modal' });
    } else if (scene === 'web_search') {
      const parsed = WebSearchSecretSchema.parse(payload);
      if (!this.deps.saveConfig) throw new Error('Configuration save is unavailable.');
      const expected = structuredClone(config);
      const next = structuredClone(config);
      const existingProviders = [...(next.tools?.web?.search?.providers ?? [])];
      const filtered = existingProviders.filter((entry) => entry.type !== parsed.providerType);
      filtered.unshift({
        type: parsed.providerType,
        ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
        ...(parsed.url ? { url: parsed.url } : {}),
        disabled: false,
      });
      next.tools = {
        ...next.tools,
        web: {
          ...(next.tools?.web ?? {}),
          search: {
            maxResults: next.tools?.web?.search?.maxResults ?? 5,
            providers: filtered,
          },
        },
      };
      const validated = ConfigSchema.parse(next);
      const saved = await this.deps.saveConfig(validated, expected);
      if (!saved.saved) throw new Error(saved.error ?? 'Failed to save web search config.');
      this.deps.emitEvent?.('config.reload', { section: 'web_search', source: 'setup-modal' });
    } else if (scene === 'voice') {
      const parsed = VoiceSecretSchema.parse(payload);
      if (!this.deps.saveConfig) throw new Error('Configuration save is unavailable.');
      const expected = structuredClone(config);
      const next = structuredClone(config);
      if (parsed.capability === 'tts') {
        const prevTts = next.messages?.tts;
        const prevProvider = prevTts?.providers?.[parsed.provider] ?? {};
        next.messages = {
          ...next.messages,
          tts: {
            trigger: prevTts?.trigger ?? 'off',
            maxTextLength: prevTts?.maxTextLength ?? 512,
            timeoutMs: prevTts?.timeoutMs ?? 60_000,
            ...(prevTts ?? {}),
            enabled: true,
            provider: parsed.provider,
            providers: {
              ...(prevTts?.providers ?? {}),
              [parsed.provider]: {
                ...prevProvider,
                ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
                ...(parsed.voice ? { voice: parsed.voice } : {}),
                ...(parsed.model ? { model: parsed.model } : {}),
              },
            },
          },
        };
      } else {
        const prevStt = next.tools?.media?.audio;
        const prevProvider = prevStt?.providers?.[parsed.provider] ?? {};
        next.tools = {
          ...next.tools,
          media: {
            ...(next.tools?.media ?? {}),
            audio: {
              fallback: prevStt?.fallback ?? { enabled: false, order: [] },
              ...(prevStt ?? {}),
              enabled: true,
              provider: parsed.provider,
              providers: {
                ...(prevStt?.providers ?? {}),
                [parsed.provider]: {
                  ...prevProvider,
                  ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
                  ...(parsed.model ? { model: parsed.model } : {}),
                },
              },
            },
          },
        };
      }
      const validated = ConfigSchema.parse(next);
      const saved = await this.deps.saveConfig(validated, expected);
      if (!saved.saved) throw new Error(saved.error ?? 'Failed to save voice config.');
      this.deps.emitEvent?.('config.reload', { section: 'voice', source: 'setup-modal' });
    } else if (scene === 'channels') {
      const parsed = ChannelsSecretSchema.parse(payload);
      if (!this.deps.saveConfig) throw new Error('Configuration save is unavailable.');
      const expected = structuredClone(config);
      const next = structuredClone(config);
      const prev = (next.channels?.[parsed.channel] && typeof next.channels[parsed.channel] === 'object'
        ? { ...(next.channels[parsed.channel] as Record<string, unknown>) }
        : {}) as Record<string, unknown>;
      next.channels = {
        ...next.channels,
        [parsed.channel]: {
          ...prev,
          enabled: true,
          ...(parsed.botToken ? { botToken: parsed.botToken } : {}),
          ...(parsed.dmPolicy ? { dmPolicy: parsed.dmPolicy } : {}),
          ...(parsed.groupPolicy ? { groupPolicy: parsed.groupPolicy } : {}),
        },
      };
      const validated = ConfigSchema.parse(next);
      const saved = await this.deps.saveConfig(validated, expected);
      if (!saved.saved) throw new Error(saved.error ?? 'Failed to save channel config.');
      this.deps.emitEvent?.('config.reload', { section: 'channels', source: 'setup-modal' });
    } else if (scene === 'computer') {
      const parsed = ComputerConfirmSchema.parse(payload);
      if (!this.deps.saveConfig) throw new Error('Configuration save is unavailable.');
      const expected = structuredClone(config);
      const next = structuredClone(config);
      next.computer = { ...next.computer, enabled: parsed.enabled };
      const validated = ConfigSchema.parse(next);
      const saved = await this.deps.saveConfig(validated, expected);
      if (!saved.saved) throw new Error(saved.error ?? 'Failed to save Computer Use config.');
      this.deps.emitEvent?.('config.reload', { section: 'computer', source: 'setup-modal' });
    }

    const { status } = await this.evaluateScene(scene);
    const updated: UnifiedSetupRun = {
      ...current,
      revision: current.revision + 1,
      state: status.configured ? 'ready_to_verify' : 'needs_input',
      checks: { configured: status.configured, verified: false },
      missingSteps: status.blockers,
      summary: status.summary,
      error: undefined,
      updatedAt: Date.now(),
    };
    return this.put(updated);
  }

  private extractTarget(args: Record<string, unknown>): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const key of ['capability', 'providerId', 'provider', 'channel'] as const) {
      const val = args[key];
      if (typeof val === 'string' && val.trim()) {
        out[key] = val.trim().slice(0, 100);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
