import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { AgentDefaults } from '../agent-config/index.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { ConfigSchema, type Config } from '../config/schema.js';
import { listGlobalDefaults, prepareUpdateGlobalDefaults, updateGlobalDefaults } from '../gateway/global-defaults-admin.js';
import { getPersonalAgent } from '../personal-agent/repository.js';
import { patchPersonalProfile, PersonalAppearanceSchema } from '../personal-agent/service.js';
import { voiceCallPreferencesPatchSchema } from '@xopcai/realtime-protocol/voice';
import {
  deleteAvatarForTarget,
  restoreAvatarFromSnapshot,
  setAvatarFromSource,
  type AvatarMutationDeps,
  type AvatarRollbackSnapshot,
  type SetAvatarInput,
} from './avatar.js';
import { inspectSelfConfig } from './inspect.js';
import type {
  SelfConfigAvatarTarget,
  SelfConfigChangeReceipt,
  SelfConfigDomain,
  SelfConfigFieldDiff,
  SelfConfigInspectResult,
  SelfConfigMutationResult,
  SetupSceneId,
} from './types.js';

const MAX_RECEIPTS = 100;

const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|passwd|credential|oauth|private[_-]?key|authorization|cookie|providers\.|gateway\.auth)/i;

const TIER3_TARGETS: Record<string, { scene: SetupSceneId; settingsSection: string }> = {
  providers: { scene: 'models', settingsSection: 'capabilities/models' },
  'gateway.auth': { scene: 'models', settingsSection: 'gateway' },
  credentials: { scene: 'models', settingsSection: 'capabilities/models' },
  oauth: { scene: 'models', settingsSection: 'capabilities/models' },
};

export const SELF_CONFIG_TARGETS = [
  'appearance.activity_detail',
  'voice.tts',
  'voice.stt',
  'personal_agent.profile',
  'compaction',
  'defaults.models',
  'web_search',
  'browser',
  'computer',
  'channels.telegram',
  'channels.weixin',
] as const;

export type SelfConfigPatchTarget = (typeof SELF_CONFIG_TARGETS)[number];

const TIER1_TARGETS = new Set<SelfConfigPatchTarget>([
  'appearance.activity_detail',
  'voice.tts',
  'voice.stt',
  'personal_agent.profile',
  'compaction',
]);

const AppearanceActivityPatchSchema = z.strictObject({
  activityDetailDefault: z.enum(['off', 'on', 'stream']),
});

const VoiceTtsPatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  trigger: z.enum(['off', 'always', 'inbound', 'tagged']).optional(),
  maxTextLength: z.number().int().min(32).max(20_000).optional(),
  voice: z.string().trim().min(1).max(200).optional(),
  model: z.string().trim().min(1).max(200).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one TTS field.');

const VoiceSttPatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  provider: z.string().trim().min(1).max(100).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one STT field.');

const PersonalProfilePatchSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(60).optional(),
  appearance: PersonalAppearanceSchema.optional(),
  voicePreference: z.strictObject({
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    voice: z.string().trim().min(1).max(200),
  }).nullable().optional(),
  voiceCallPreferences: voiceCallPreferencesPatchSchema.optional(),
  messageReactionsEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one Personal AI profile field.');

const CompactionPatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  triggerThreshold: z.number().min(0.1).max(0.98).optional(),
  recentTurnsPreserve: z.number().int().min(1).max(12).optional(),
  keepRecentTokens: z.number().int().min(1_000).max(200_000).optional(),
  qualityGuard: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one compaction field.');

const ModelRouteInputSchema = z.union([
  z.string().trim().min(3).max(256),
  z.strictObject({
    primary: z.string().trim().min(3).max(256),
    fallbacks: z.array(z.string().trim().min(3).max(256)).max(8).optional(),
  }),
]);

const DefaultsModelsPatchSchema = z.strictObject({
  chat: ModelRouteInputSchema.optional(),
  fast: ModelRouteInputSchema.optional(),
  image: ModelRouteInputSchema.optional(),
  imageGeneration: ModelRouteInputSchema.optional(),
  computerUse: ModelRouteInputSchema.optional(),
  phoneUse: ModelRouteInputSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one default model field.');

const WebSearchPatchSchema = z.strictObject({
  region: z.enum(['cn', 'global']).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one web search field.');

const BrowserPatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  driverKind: z.enum(['extension', 'playwright', 'cdp']).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one browser field.');

const ComputerPatchSchema = z.strictObject({
  enabled: z.boolean(),
});

const ChannelPolicyPatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).optional(),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).optional(),
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one channel policy field.');

function containsSecretKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = containsSecretKey(item);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) return key;
    const nested = containsSecretKey(entry);
    if (nested) return `${key}.${nested}`;
  }
  return null;
}

function normalizeModelRoute(input: z.infer<typeof ModelRouteInputSchema>): { primary: string; fallbacks: string[] } {
  if (typeof input === 'string') return { primary: input, fallbacks: [] };
  return { primary: input.primary, fallbacks: input.fallbacks ?? [] };
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return 'unset';
  if (typeof value === 'string') return value.slice(0, 200);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value).slice(0, 240);
}

type StoredReceipt = {
  receipt: SelfConfigChangeReceipt;
  rollback: () => Promise<void>;
};

export interface SelfConfigServiceDeps {
  getConfig: () => Config | undefined;
  saveConfig?: (next: Config, expected?: Config) => Promise<{ saved: boolean; error?: string; conflict?: boolean }>;
  getWorkspace?: () => string | undefined;
  onAgentCatalogMutate?: () => void;
  evictSessionAgent?: (conversationId: string) => void;
  emitEvent?: (event: string, payload: unknown) => void;
}

/**
 * Risk-tiered self-configuration service:
 * - Tier 1: low-risk reversible preferences (apply directly + rollback receipt)
 * - Tier 2: operational defaults/policies (dryRun preview or explicit confirm + rollback receipt)
 * - Tier 3: credentials / auth secrets (blocked from chat; routes to secure interactionPath)
 */
export class SelfConfigService {
  private readonly receipts = new Map<string, StoredReceipt>();
  private readonly order: string[] = [];

  constructor(private readonly deps: SelfConfigServiceDeps) {}

  private recordReceipt(receipt: SelfConfigChangeReceipt, rollback: () => Promise<void>): void {
    this.receipts.set(receipt.changeId, { receipt, rollback });
    this.order.push(receipt.changeId);
    while (this.order.length > MAX_RECEIPTS) {
      const oldest = this.order.shift();
      if (oldest) this.receipts.delete(oldest);
    }
  }

  listChanges(limit = 20): SelfConfigChangeReceipt[] {
    return this.order
      .slice(-Math.max(1, Math.min(limit, MAX_RECEIPTS)))
      .reverse()
      .map((id) => this.receipts.get(id)?.receipt)
      .filter((item): item is SelfConfigChangeReceipt => Boolean(item));
  }

  getChange(changeId: string): SelfConfigChangeReceipt | undefined {
    return this.receipts.get(changeId)?.receipt;
  }

  async inspect(domain: SelfConfigDomain = 'all', ownerId?: string): Promise<SelfConfigInspectResult> {
    const config = this.deps.getConfig();
    if (!config) {
      throw new Error('Host configuration is unavailable.');
    }
    return inspectSelfConfig(config, { domain, ownerId });
  }

  private avatarDeps(ownerId?: string): AvatarMutationDeps {
    return {
      workspace: this.deps.getWorkspace?.(),
      ownerId: ownerId ?? 'local-owner',
      onAgentCatalogMutate: this.deps.onAgentCatalogMutate,
      evictSessionAgent: this.deps.evictSessionAgent,
      emitEvent: this.deps.emitEvent,
    };
  }

  async setAvatar(
    input: SetAvatarInput,
    options: { conversationId?: string; ownerId?: string; dryRun?: boolean } = {},
  ): Promise<SelfConfigMutationResult> {
    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        tier: 1,
        summary: `Would update ${input.target} avatar from ${input.source ?? input.preset ?? 'input'}.`,
      };
    }
    const avatarDeps = this.avatarDeps(options.ownerId);
    const outcome = await setAvatarFromSource(input, avatarDeps);
    const title = input.target === 'user'
      ? 'User avatar'
      : input.target === 'personal_agent'
        ? 'Personal AI avatar'
        : `Agent avatar (${outcome.agentId})`;
    const receipt: SelfConfigChangeReceipt = {
      changeId: randomUUID(),
      conversationId: options.conversationId,
      tier: 1,
      target: `${input.target}.avatar`,
      title,
      summary: `Updated ${title}: ${outcome.beforeLabel} → ${outcome.afterLabel}`,
      settingsSection: outcome.settingsSection,
      changes: [{ field: 'avatar', before: outcome.beforeLabel, after: outcome.afterLabel }],
      createdAt: Date.now(),
      canRollback: true,
    };
    const snapshot: AvatarRollbackSnapshot = outcome.rollback;
    this.recordReceipt(receipt, async () => {
      await restoreAvatarFromSnapshot(snapshot, avatarDeps);
    });
    return { ok: true, tier: 1, receipt, summary: receipt.summary };
  }

  async deleteAvatar(
    input: { target: SelfConfigAvatarTarget; agentId?: string },
    options: { conversationId?: string; ownerId?: string; dryRun?: boolean } = {},
  ): Promise<SelfConfigMutationResult> {
    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        tier: 1,
        summary: `Would delete custom ${input.target} avatar.`,
      };
    }
    const avatarDeps = this.avatarDeps(options.ownerId);
    const outcome = await deleteAvatarForTarget(input, avatarDeps);
    const title = input.target === 'user'
      ? 'User avatar'
      : input.target === 'personal_agent'
        ? 'Personal AI avatar'
        : `Agent avatar (${outcome.agentId})`;
    const receipt: SelfConfigChangeReceipt = {
      changeId: randomUUID(),
      conversationId: options.conversationId,
      tier: 1,
      target: `${input.target}.avatar`,
      title,
      summary: `Removed ${title}: ${outcome.beforeLabel} → ${outcome.afterLabel}`,
      settingsSection: outcome.settingsSection,
      changes: [{ field: 'avatar', before: outcome.beforeLabel, after: outcome.afterLabel }],
      createdAt: Date.now(),
      canRollback: true,
    };
    const snapshot: AvatarRollbackSnapshot = outcome.rollback;
    this.recordReceipt(receipt, async () => {
      await restoreAvatarFromSnapshot(snapshot, avatarDeps);
    });
    return { ok: true, tier: 1, receipt, summary: receipt.summary };
  }

  async patch(input: {
    target: string;
    patch: Record<string, unknown>;
    confirm?: boolean;
    dryRun?: boolean;
    conversationId?: string;
    ownerId?: string;
  }): Promise<SelfConfigMutationResult> {
    const rawTarget = input.target.trim();
    const secretKey = containsSecretKey(input.patch);
    const tier3Match = Object.entries(TIER3_TARGETS).find(
      ([prefix]) => rawTarget === prefix || rawTarget.startsWith(`${prefix}.`),
    );

    if (secretKey || tier3Match || SECRET_KEY_PATTERN.test(rawTarget)) {
      const scene: SetupSceneId = tier3Match?.[1].scene
        ?? (rawTarget.includes('search') ? 'web_search'
          : rawTarget.includes('voice') || rawTarget.includes('tts') || rawTarget.includes('stt') ? 'voice'
            : rawTarget.includes('channel') || rawTarget.includes('telegram') || rawTarget.includes('weixin') ? 'channels'
              : 'models');
      const settingsSection = tier3Match?.[1].settingsSection ?? 'capabilities/models';
      return {
        ok: false,
        tier: 3,
        requiresInteraction: true,
        setupScene: scene,
        settingsSection,
        error: `Credentials and secrets (${secretKey ?? rawTarget}) cannot be modified directly in chat. Start guided setup for scene "${scene}" to open a secure input modal.`,
      };
    }

    if (!SELF_CONFIG_TARGETS.includes(rawTarget as SelfConfigPatchTarget)) {
      return {
        ok: false,
        error: `Unsupported self-config target "${rawTarget}". Allowed targets: ${SELF_CONFIG_TARGETS.join(', ')}.`,
      };
    }

    const target = rawTarget as SelfConfigPatchTarget;
    const tier: 1 | 2 = TIER1_TARGETS.has(target) ? 1 : 2;
    if (tier === 2 && !input.dryRun && input.confirm !== true) {
      const preview = await this.patch({ ...input, dryRun: true });
      return {
        ...preview,
        ok: false,
        tier: 2,
        requiresConfirmation: true,
        error: 'Tier 2 configuration changes require confirm: true after reviewing the proposed change with the user.',
      };
    }

    if (target === 'personal_agent.profile') {
      return this.patchPersonalAgentProfile(input.patch, input);
    }
    if (target === 'defaults.models') {
      return this.patchDefaultsModels(input.patch, input);
    }
    return this.patchHostConfig(target, tier, input.patch, input);
  }

  private async patchPersonalAgentProfile(
    rawPatch: Record<string, unknown>,
    options: { dryRun?: boolean; conversationId?: string; ownerId?: string },
  ): Promise<SelfConfigMutationResult> {
    const parsed = PersonalProfilePatchSchema.safeParse(rawPatch);
    if (!parsed.success) {
      return { ok: false, tier: 1, error: parsed.error.issues[0]?.message ?? 'Invalid personal profile patch' };
    }
    const ownerId = options.ownerId ?? 'local-owner';
    const current = getPersonalAgent(ownerId);
    if (!current || current.state !== 'ready') {
      return { ok: false, tier: 1, error: 'Personal AI is not initialized yet.' };
    }
    const patch = parsed.data;
    const nextDisplayName = patch.displayName ?? current.displayName;
    const nextAppearance = patch.appearance ?? current.appearance;
    const changes: SelfConfigFieldDiff[] = [];
    if (patch.displayName !== undefined && patch.displayName !== current.displayName) {
      changes.push({ field: 'displayName', before: current.displayName, after: patch.displayName });
    }
    if (patch.appearance !== undefined && patch.appearance !== current.appearance) {
      changes.push({ field: 'appearance', before: current.appearance, after: patch.appearance });
    }
    if (patch.voicePreference !== undefined) {
      changes.push({
        field: 'voicePreference',
        before: formatValue(current.voicePreference?.voice ?? null),
        after: formatValue(patch.voicePreference?.voice ?? null),
      });
    }
    if (patch.voiceCallPreferences !== undefined) {
      changes.push({
        field: 'voiceCallPreferences',
        before: formatValue(current.voiceCallPreferences ?? {}),
        after: formatValue(patch.voiceCallPreferences),
      });
    }
    if (patch.messageReactionsEnabled !== undefined && patch.messageReactionsEnabled !== current.messageReactionsEnabled) {
      changes.push({
        field: 'messageReactionsEnabled',
        before: formatValue(current.messageReactionsEnabled),
        after: formatValue(patch.messageReactionsEnabled),
      });
    }
    if (changes.length === 0) {
      return { ok: true, tier: 1, summary: 'No Personal AI profile fields changed.' };
    }
    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        tier: 1,
        summary: `Would update Personal AI profile: ${changes.map((c) => `${c.field} (${c.before} → ${c.after})`).join(', ')}.`,
      };
    }

    const previousSnapshot = {
      displayName: current.displayName,
      appearance: current.appearance,
      voicePreference: current.voicePreference ?? null,
      voiceCallPreferences: current.voiceCallPreferences,
      messageReactionsEnabled: current.messageReactionsEnabled,
    };
    const host = {
      refreshAgentCatalog: () => this.deps.onAgentCatalogMutate?.(),
      agentService: {
        evictSessionAgent: (conversationId: string) => this.deps.evictSessionAgent?.(conversationId),
      },
    };
    const updated = await patchPersonalProfile(
      host,
      ownerId,
      current.revision,
      nextDisplayName,
      nextAppearance,
      patch.voicePreference,
      patch.voiceCallPreferences,
      patch.messageReactionsEnabled,
    );
    if (!updated) {
      return { ok: false, tier: 1, error: 'Personal AI profile changed concurrently; please retry.' };
    }
    this.deps.emitEvent?.('personal.agent.updated', updated);

    const receipt: SelfConfigChangeReceipt = {
      changeId: randomUUID(),
      conversationId: options.conversationId,
      tier: 1,
      target: 'personal_agent.profile',
      title: 'Personal AI profile',
      summary: `Updated Personal AI profile: ${changes.map((c) => `${c.field} → ${c.after}`).join(', ')}`,
      settingsSection: 'personal',
      changes,
      createdAt: Date.now(),
      canRollback: true,
    };
    this.recordReceipt(receipt, async () => {
      const latest = getPersonalAgent(ownerId);
      if (!latest || latest.state !== 'ready') throw new Error('Personal AI is unavailable');
      const restored = await patchPersonalProfile(
        host,
        ownerId,
        latest.revision,
        previousSnapshot.displayName,
        previousSnapshot.appearance,
        previousSnapshot.voicePreference,
        previousSnapshot.voiceCallPreferences,
        previousSnapshot.messageReactionsEnabled,
      );
      if (!restored) throw new Error('Personal AI profile changed concurrently; rollback failed.');
      this.deps.emitEvent?.('personal.agent.updated', restored);
    });
    return { ok: true, tier: 1, receipt, summary: receipt.summary };
  }

  private async patchDefaultsModels(
    rawPatch: Record<string, unknown>,
    options: { dryRun?: boolean; conversationId?: string },
  ): Promise<SelfConfigMutationResult> {
    const parsed = DefaultsModelsPatchSchema.safeParse(rawPatch);
    if (!parsed.success) {
      return { ok: false, tier: 2, error: parsed.error.issues[0]?.message ?? 'Invalid model defaults patch' };
    }
    const previousDefaults: AgentDefaults = structuredClone(listGlobalDefaults().defaults);
    const nextDefaults: AgentDefaults = structuredClone(previousDefaults);
    const changes: SelfConfigFieldDiff[] = [];
    const patch = parsed.data;

    if (patch.chat !== undefined) {
      const route = normalizeModelRoute(patch.chat);
      changes.push({ field: 'models.chat', before: previousDefaults.models.chat?.primary ?? 'unset', after: route.primary });
      nextDefaults.models.chat = route;
    }
    if (patch.fast !== undefined) {
      const route = normalizeModelRoute(patch.fast);
      changes.push({ field: 'models.intents.fast', before: previousDefaults.models.intents?.fast?.primary ?? 'unset', after: route.primary });
      nextDefaults.models.intents = { ...nextDefaults.models.intents, fast: route };
    }
    if (patch.image !== undefined) {
      const route = normalizeModelRoute(patch.image);
      changes.push({ field: 'models.intents.vision', before: previousDefaults.models.intents?.vision?.primary ?? 'unset', after: route.primary });
      nextDefaults.models.intents = { ...nextDefaults.models.intents, vision: route };
    }
    if (patch.imageGeneration !== undefined) {
      const route = normalizeModelRoute(patch.imageGeneration);
      changes.push({ field: 'models.imageGeneration', before: previousDefaults.models.imageGeneration?.primary ?? 'unset', after: route.primary });
      nextDefaults.models.imageGeneration = { ...nextDefaults.models.imageGeneration, ...route };
    }
    if (patch.computerUse !== undefined) {
      const route = normalizeModelRoute(patch.computerUse);
      changes.push({ field: 'models.computerUse', before: previousDefaults.models.computerUse?.primary ?? 'unset', after: route.primary });
      nextDefaults.models.computerUse = route;
    }
    if (patch.phoneUse !== undefined) {
      const route = normalizeModelRoute(patch.phoneUse);
      changes.push({ field: 'models.phoneUse', before: previousDefaults.models.phoneUse?.primary ?? 'unset', after: route.primary });
      nextDefaults.models.phoneUse = route;
    }

    const prepared = prepareUpdateGlobalDefaults({ defaults: nextDefaults, scope: 'models' });
    if (prepared.ok === false) {
      return { ok: false, tier: 2, error: prepared.error };
    }
    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        tier: 2,
        summary: `Would update global default models: ${changes.map((c) => `${c.field} (${c.before} → ${c.after})`).join(', ')}.`,
      };
    }

    const updated = updateGlobalDefaults({ defaults: nextDefaults, scope: 'models' });
    if (updated.ok === false) {
      return { ok: false, tier: 2, error: updated.error };
    }
    if (updated.data.changed) {
      this.deps.onAgentCatalogMutate?.();
      this.deps.emitEvent?.('config.reload', { section: 'models', source: 'self-config' });
    }

    const receipt: SelfConfigChangeReceipt = {
      changeId: randomUUID(),
      conversationId: options.conversationId,
      tier: 2,
      target: 'defaults.models',
      title: 'Global default models',
      summary: `Updated global default models: ${changes.map((c) => `${c.field} → ${c.after}`).join(', ')}`,
      settingsSection: 'capabilities/models',
      changes,
      createdAt: Date.now(),
      canRollback: true,
    };
    this.recordReceipt(receipt, async () => {
      const restored = updateGlobalDefaults({ defaults: previousDefaults, scope: 'models' });
      if (restored.ok === false) throw new Error(restored.error);
      this.deps.onAgentCatalogMutate?.();
      this.deps.emitEvent?.('config.reload', { section: 'models', source: 'self-config-rollback' });
    });
    return { ok: true, tier: 2, receipt, summary: receipt.summary };
  }

  private async patchHostConfig(
    target: Exclude<SelfConfigPatchTarget, 'personal_agent.profile' | 'defaults.models'>,
    tier: 1 | 2,
    rawPatch: Record<string, unknown>,
    options: { dryRun?: boolean; conversationId?: string },
  ): Promise<SelfConfigMutationResult> {
    const current = this.deps.getConfig();
    if (!current) {
      return { ok: false, tier, error: 'Host configuration is unavailable.' };
    }
    if (!options.dryRun && !this.deps.saveConfig) {
      return { ok: false, tier, error: 'Host configuration saving is unavailable in this runtime.' };
    }

    const expected = structuredClone(current);
    const next = structuredClone(current);
    const changes: SelfConfigFieldDiff[] = [];
    let title = target as string;
    let settingsSection = 'overview';

    switch (target) {
      case 'appearance.activity_detail': {
        const parsed = AppearanceActivityPatchSchema.safeParse(rawPatch);
        if (!parsed.success) return { ok: false, tier, error: parsed.error.issues[0]?.message ?? 'Invalid appearance patch' };
        title = 'Activity detail display';
        settingsSection = 'appearance';
        const before = current.gateway?.webchat?.activityDetailDefault ?? 'on';
        const after = parsed.data.activityDetailDefault;
        if (before !== after) {
          changes.push({ field: 'activityDetailDefault', before, after });
          next.gateway = {
            ...next.gateway,
            webchat: { ...(next.gateway?.webchat ?? { activityDetailDefault: 'on' }), activityDetailDefault: after },
          };
        }
        break;
      }
      case 'voice.tts': {
        const parsed = VoiceTtsPatchSchema.safeParse(rawPatch);
        if (!parsed.success) return { ok: false, tier, error: parsed.error.issues[0]?.message ?? 'Invalid TTS patch' };
        title = 'Voice (TTS) settings';
        settingsSection = 'capabilities/voice';
        const prevTts = current.messages?.tts;
        const nextTts = {
          enabled: prevTts?.enabled ?? true,
          provider: prevTts?.provider ?? 'edge',
          trigger: prevTts?.trigger ?? 'off',
          maxTextLength: prevTts?.maxTextLength ?? 512,
          timeoutMs: prevTts?.timeoutMs ?? 60_000,
          ...(prevTts ?? {}),
        };
        if (parsed.data.enabled !== undefined && parsed.data.enabled !== nextTts.enabled) {
          changes.push({ field: 'tts.enabled', before: String(nextTts.enabled), after: String(parsed.data.enabled) });
          nextTts.enabled = parsed.data.enabled;
        }
        if (parsed.data.provider !== undefined && parsed.data.provider !== nextTts.provider) {
          changes.push({ field: 'tts.provider', before: nextTts.provider, after: parsed.data.provider });
          nextTts.provider = parsed.data.provider;
        }
        if (parsed.data.trigger !== undefined && parsed.data.trigger !== nextTts.trigger) {
          changes.push({ field: 'tts.trigger', before: nextTts.trigger, after: parsed.data.trigger });
          nextTts.trigger = parsed.data.trigger;
        }
        if (parsed.data.maxTextLength !== undefined && parsed.data.maxTextLength !== nextTts.maxTextLength) {
          changes.push({ field: 'tts.maxTextLength', before: String(nextTts.maxTextLength), after: String(parsed.data.maxTextLength) });
          nextTts.maxTextLength = parsed.data.maxTextLength;
        }
        if (parsed.data.voice !== undefined || parsed.data.model !== undefined) {
          const providerId = nextTts.provider;
          const prevProviderCfg = nextTts.providers?.[providerId] ?? {};
          const nextProviderCfg = { ...prevProviderCfg };
          if (parsed.data.voice !== undefined && parsed.data.voice !== prevProviderCfg.voice) {
            changes.push({ field: `tts.${providerId}.voice`, before: formatValue(prevProviderCfg.voice), after: parsed.data.voice });
            nextProviderCfg.voice = parsed.data.voice;
          }
          if (parsed.data.model !== undefined && parsed.data.model !== prevProviderCfg.model) {
            changes.push({ field: `tts.${providerId}.model`, before: formatValue(prevProviderCfg.model), after: parsed.data.model });
            nextProviderCfg.model = parsed.data.model;
          }
          nextTts.providers = { ...(nextTts.providers ?? {}), [providerId]: nextProviderCfg };
        }
        next.messages = { ...next.messages, tts: nextTts };
        break;
      }
      case 'voice.stt': {
        const parsed = VoiceSttPatchSchema.safeParse(rawPatch);
        if (!parsed.success) return { ok: false, tier, error: parsed.error.issues[0]?.message ?? 'Invalid STT patch' };
        title = 'Voice (STT) settings';
        settingsSection = 'capabilities/voice';
        const prevStt = current.tools?.media?.audio;
        const nextStt = {
          enabled: prevStt?.enabled ?? false,
          provider: prevStt?.provider ?? 'openai',
          fallback: prevStt?.fallback ?? { enabled: false, order: [] },
          ...(prevStt ?? {}),
        };
        if (parsed.data.enabled !== undefined && parsed.data.enabled !== nextStt.enabled) {
          changes.push({ field: 'stt.enabled', before: String(nextStt.enabled), after: String(parsed.data.enabled) });
          nextStt.enabled = parsed.data.enabled;
        }
        if (parsed.data.provider !== undefined && parsed.data.provider !== nextStt.provider) {
          changes.push({ field: 'stt.provider', before: nextStt.provider, after: parsed.data.provider });
          nextStt.provider = parsed.data.provider;
        }
        next.tools = { ...next.tools, media: { ...(next.tools?.media ?? {}), audio: nextStt } };
        break;
      }
      case 'compaction': {
        const parsed = CompactionPatchSchema.safeParse(rawPatch);
        if (!parsed.success) return { ok: false, tier, error: parsed.error.issues[0]?.message ?? 'Invalid compaction patch' };
        title = 'Context compaction settings';
        settingsSection = 'session';
        const prevComp = current.userContext.contextPlanning.compaction;
        const nextComp = { ...prevComp };
        for (const key of ['enabled', 'triggerThreshold', 'recentTurnsPreserve', 'keepRecentTokens', 'qualityGuard'] as const) {
          const val = parsed.data[key];
          if (val !== undefined && val !== prevComp[key]) {
            changes.push({ field: `compaction.${key}`, before: String(prevComp[key]), after: String(val) });
            (nextComp as Record<string, unknown>)[key] = val;
          }
        }
        next.userContext = {
          ...next.userContext,
          contextPlanning: { ...next.userContext.contextPlanning, compaction: nextComp },
        };
        break;
      }
      case 'web_search': {
        const parsed = WebSearchPatchSchema.safeParse(rawPatch);
        if (!parsed.success) return { ok: false, tier, error: parsed.error.issues[0]?.message ?? 'Invalid web search patch' };
        title = 'Web search settings';
        settingsSection = 'capabilities/web-search';
        const prevWeb = current.tools?.web;
        const nextWeb = { ...(prevWeb ?? {}) };
        if (parsed.data.region !== undefined && parsed.data.region !== prevWeb?.region) {
          changes.push({ field: 'web.region', before: formatValue(prevWeb?.region), after: parsed.data.region });
          nextWeb.region = parsed.data.region;
        }
        if (parsed.data.maxResults !== undefined && parsed.data.maxResults !== prevWeb?.search?.maxResults) {
          changes.push({
            field: 'web.search.maxResults',
            before: formatValue(prevWeb?.search?.maxResults ?? 5),
            after: String(parsed.data.maxResults),
          });
          nextWeb.search = {
            providers: prevWeb?.search?.providers ?? [],
            ...(prevWeb?.search ?? {}),
            maxResults: parsed.data.maxResults,
          };
        }
        next.tools = { ...next.tools, web: nextWeb };
        break;
      }
      case 'browser': {
        const parsed = BrowserPatchSchema.safeParse(rawPatch);
        if (!parsed.success) return { ok: false, tier, error: parsed.error.issues[0]?.message ?? 'Invalid browser patch' };
        title = 'Browser Use settings';
        settingsSection = 'agent-browser';
        if (parsed.data.enabled !== undefined && parsed.data.enabled !== current.browser.enabled) {
          changes.push({ field: 'browser.enabled', before: String(current.browser.enabled), after: String(parsed.data.enabled) });
          next.browser = { ...next.browser, enabled: parsed.data.enabled };
        }
        if (parsed.data.driverKind !== undefined && parsed.data.driverKind !== current.browser.driver.kind) {
          changes.push({ field: 'browser.driver.kind', before: current.browser.driver.kind, after: parsed.data.driverKind });
          next.browser = {
            ...next.browser,
            driver: parsed.data.driverKind === 'playwright'
              ? { kind: 'playwright', headless: false }
              : parsed.data.driverKind === 'cdp'
                ? { kind: 'cdp', endpoint: 'http://127.0.0.1:9222' }
                : { kind: 'extension' },
          };
        }
        break;
      }
      case 'computer': {
        const parsed = ComputerPatchSchema.safeParse(rawPatch);
        if (!parsed.success) return { ok: false, tier, error: parsed.error.issues[0]?.message ?? 'Invalid computer patch' };
        title = 'Computer Use settings';
        settingsSection = 'agent-computer';
        if (parsed.data.enabled !== current.computer.enabled) {
          changes.push({ field: 'computer.enabled', before: String(current.computer.enabled), after: String(parsed.data.enabled) });
          next.computer = { ...next.computer, enabled: parsed.data.enabled };
        }
        break;
      }
      case 'channels.telegram':
      case 'channels.weixin': {
        const parsed = ChannelPolicyPatchSchema.safeParse(rawPatch);
        if (!parsed.success) return { ok: false, tier, error: parsed.error.issues[0]?.message ?? 'Invalid channel policy patch' };
        const channelKey = target === 'channels.telegram' ? 'telegram' : 'weixin';
        title = `${channelKey === 'telegram' ? 'Telegram' : 'Weixin'} channel policy`;
        settingsSection = 'channels';
        const prevChannel = (current.channels?.[channelKey] && typeof current.channels[channelKey] === 'object'
          ? { ...(current.channels[channelKey] as Record<string, unknown>) }
          : {}) as Record<string, unknown>;
        const nextChannel = { ...prevChannel };
        for (const key of ['enabled', 'dmPolicy', 'groupPolicy', 'streamMode'] as const) {
          const val = parsed.data[key];
          if (val !== undefined && val !== prevChannel[key]) {
            changes.push({ field: `${channelKey}.${key}`, before: formatValue(prevChannel[key]), after: String(val) });
            nextChannel[key] = val;
          }
        }
        next.channels = { ...next.channels, [channelKey]: nextChannel };
        break;
      }
    }

    const validated = ConfigSchema.safeParse(next);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      return { ok: false, tier, error: `Invalid configuration (${issue?.path.join('.')}: ${issue?.message})` };
    }
    if (changes.length === 0) {
      return { ok: true, tier, summary: `No changes needed for ${title}.` };
    }
    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        tier,
        summary: `Would update ${title}: ${changes.map((c) => `${c.field} (${c.before} → ${c.after})`).join(', ')}.`,
      };
    }

    const saved = await this.deps.saveConfig!(validated.data, expected);
    if (!saved.saved) {
      return { ok: false, tier, error: saved.error ?? 'Failed to save configuration.' };
    }
    this.deps.emitEvent?.('config.reload', { section: target, source: 'self-config' });

    const receipt: SelfConfigChangeReceipt = {
      changeId: randomUUID(),
      conversationId: options.conversationId,
      tier,
      target,
      title,
      summary: `Updated ${title}: ${changes.map((c) => `${c.field} → ${c.after}`).join(', ')}`,
      settingsSection,
      changes,
      createdAt: Date.now(),
      canRollback: true,
    };
    this.recordReceipt(receipt, async () => {
      const latest = this.deps.getConfig();
      if (!latest || !this.deps.saveConfig) throw new Error('Host configuration is unavailable');
      const restored = structuredClone(latest);
      if (target === 'appearance.activity_detail') restored.gateway = structuredClone(expected.gateway);
      else if (target === 'voice.tts') restored.messages = structuredClone(expected.messages);
      else if (target === 'voice.stt') restored.tools = { ...restored.tools, media: structuredClone(expected.tools?.media) };
      else if (target === 'compaction') restored.userContext = {
        ...restored.userContext,
        contextPlanning: { ...restored.userContext.contextPlanning, compaction: structuredClone(expected.userContext.contextPlanning.compaction) },
      };
      else if (target === 'web_search') restored.tools = { ...restored.tools, web: structuredClone(expected.tools?.web) };
      else if (target === 'browser') restored.browser = structuredClone(expected.browser);
      else if (target === 'computer') restored.computer = structuredClone(expected.computer);
      else if (target === 'channels.telegram' || target === 'channels.weixin') restored.channels = structuredClone(expected.channels);
      const res = await this.deps.saveConfig(restored, latest);
      if (!res.saved) throw new Error(res.error ?? 'Rollback save failed');
      this.deps.emitEvent?.('config.reload', { section: target, source: 'self-config-rollback' });
    });

    return { ok: true, tier, receipt, summary: receipt.summary };
  }

  async rollback(changeId: string): Promise<{ ok: boolean; receipt?: SelfConfigChangeReceipt; error?: string }> {
    const entry = this.receipts.get(changeId);
    if (!entry) {
      return { ok: false, error: `Change receipt not found: ${changeId}` };
    }
    if (entry.receipt.rolledBackAt) {
      return { ok: false, error: 'This change has already been rolled back.' };
    }
    if (!entry.receipt.canRollback) {
      return { ok: false, error: 'This change cannot be rolled back automatically.' };
    }
    try {
      await entry.rollback();
      entry.receipt.rolledBackAt = Date.now();
      entry.receipt.canRollback = false;
      return { ok: true, receipt: { ...entry.receipt } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function isAgentCatalogOpen(): boolean {
  try {
    new AgentCatalogRepository();
    return true;
  } catch {
    return false;
  }
}
