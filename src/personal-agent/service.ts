import { z } from 'zod';

import { ResponsePreferencesSchema } from '../agent-config/index.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import { getAvailableModels } from '../providers/index.js';
import { getModelThinking } from '../providers/model-thinking.js';
import { createConversation } from '../storage/sqlite/conversation-repository.js';
import { getSessionMetadata, patchSessionMetadata } from '../storage/sqlite/session-repository.js';
import { setSessionConfig } from '../storage/sqlite/config-repository.js';
import { PERSONAL_MAIN_TOOL_IDS, PERSONAL_READ_TOOL_ALIASES } from './policy.js';
import { personalInstructions, upgradePersonalInstructions } from './prompts.js';
import { completePersonalOnboarding } from './onboarding.js';
import {
  DEFAULT_PERSONAL_PREFERENCES, getPersonalAgent, personalAgentId,
  type PersonalAgentRecord,
} from './repository.js';

export { personalInstructions } from './prompts.js';

export const PersonalPreferencesSchema = ResponsePreferencesSchema;

export type PersonalPreferences = z.infer<typeof PersonalPreferencesSchema>;
export const PersonalAppearanceSchema = z.enum(['loopi', 'loopi-curious', 'loopi-care', 'custom']);
export type PersonalAppearance = z.infer<typeof PersonalAppearanceSchema>;

type PersonalAgentHost = {
  refreshAgentCatalog(): void;
  agentService: { evictSessionAgent(conversationId: string): void };
};

function appearanceEmoji(appearance: PersonalAppearance): string {
  return appearance === 'loopi-curious' ? '◌' : appearance === 'loopi-care' ? '♡' : '◉';
}

function appearanceAvatar(appearance: PersonalAppearance): string {
  return appearance === 'custom' ? 'xopc:custom' : `xopc:loopi:${appearance === 'loopi' ? 'idle' : appearance.slice('loopi-'.length)}`;
}

export async function refreshPersonalDelegationGuidance(service: PersonalAgentHost, ownerId: string): Promise<void> {
  const repository = new AgentCatalogRepository();
  const agent = repository.get(personalAgentId(ownerId));
  const instructions = agent?.profile?.instructions;
  if (!agent || !instructions) return;
  const nextInstructions = upgradePersonalInstructions(instructions, agent.profile?.responsePreferences?.addressAs);
  const toolAllowlist = [...new Set([...(agent.toolAllowlist ?? PERSONAL_MAIN_TOOL_IDS),
    ...(agent.toolAllowlist?.includes('personal_task') ? PERSONAL_MAIN_TOOL_IDS : [])]
    .filter(name => name !== 'clarify').map(name => PERSONAL_READ_TOOL_ALIASES[name] ?? name))];
  if (nextInstructions === instructions && JSON.stringify(toolAllowlist) === JSON.stringify(agent.toolAllowlist)) return;
  try {
    await new AgentCatalogService().update(agent.id, {
      profile: { ...agent.profile!, instructions: nextInstructions },
      ...(toolAllowlist ? { toolAllowlist } : {}),
    }, agent.revision);
    service.refreshAgentCatalog?.();
    const conversationId = getPersonalAgent(ownerId)?.conversationId;
    if (conversationId) service.agentService?.evictSessionAgent(conversationId);
  } catch (error) {
    if (!(error instanceof Error && error.message === 'Agent revision conflict')) throw error;
  }
}

export async function listPersonalModels(): Promise<Array<{ id: string; name: string }>> {
  const models = await getAvailableModels();
  return models.filter(model => getModelThinking(model).options.includes('off'))
    .map(model => ({ id: `${model.provider}/${model.id}`, name: model.name ?? model.id }));
}

const inFlightProvisioning = new Map<string, Promise<PersonalAgentRecord>>();

export function ensurePersonalConversationVisibility(ownerId: string): void {
  const conversationId = getPersonalAgent(ownerId)?.conversationId;
  if (!conversationId) return;
  const session = getSessionMetadata(conversationId);
  if (!session || (session.hiddenFromSessionList && session.customData?.keepHiddenFromSessionList === true)) return;
  patchSessionMetadata(conversationId, {
    hiddenFromSessionList: true,
    customData: { ...session.customData, keepHiddenFromSessionList: true },
  });
}

export function createOrResumePersonalAgent(
  service: PersonalAgentHost,
  ownerId: string,
  requestedModel?: string,
  availableModels: typeof listPersonalModels = listPersonalModels,
  initial?: { displayName: string; appearance: Exclude<PersonalAppearance, 'custom'>; voicePreference?: { provider: string; model: string; voice: string } },
): Promise<PersonalAgentRecord> {
  const current = inFlightProvisioning.get(ownerId);
  if (current) return current;
  const pending = provisionPersonalAgent(service, ownerId, requestedModel, availableModels, initial);
  inFlightProvisioning.set(ownerId, pending);
  void pending.finally(() => {
    if (inFlightProvisioning.get(ownerId) === pending) inFlightProvisioning.delete(ownerId);
  }).catch(() => {});
  return pending;
}

async function provisionPersonalAgent(
  service: PersonalAgentHost,
  ownerId: string,
  requestedModel?: string,
  availableModels: typeof listPersonalModels = listPersonalModels,
  initial?: { displayName: string; appearance: Exclude<PersonalAppearance, 'custom'>; voicePreference?: { provider: string; model: string; voice: string } },
): Promise<PersonalAgentRecord> {
  const existingIdentity = getPersonalAgent(ownerId);
  if (existingIdentity?.state === 'ready') {
    completePersonalOnboarding(ownerId);
    await refreshPersonalDelegationGuidance(service, ownerId);
    ensurePersonalConversationVisibility(ownerId);
    return getPersonalAgent(ownerId) ?? existingIdentity;
  }
  const agentId = personalAgentId(ownerId);
  const existing = new AgentCatalogRepository().get(agentId);
  const available = await availableModels();
  const preferredModel = requestedModel ?? existing?.models?.chat?.primary;
  const fastModel = preferredModel ? undefined : new AgentCatalogRepository().getSettings().defaults.models.intents.fast?.primary;
  const chosen = preferredModel
    ? available.find(model => model.id === preferredModel)
    : available.find(model => model.id === fastModel) ?? available[0];
  if (!chosen) throw new Error('Choose a configured model that supports thinking off');
  const catalog = new AgentCatalogService();
  if (!existing) {
    await catalog.create({
      id: agentId,
      enabled: true,
      profile: {
        name: initial?.displayName ?? 'Ada',
        description: 'A personal AI that adapts its responses to the user and coordinates work.',
        creature: 'assistant',
        language: 'zh',
        emoji: appearanceEmoji(initial?.appearance ?? 'loopi'),
        avatar: appearanceAvatar(initial?.appearance ?? 'loopi'),
        ...(initial?.voicePreference ? { voicePreference: initial.voicePreference } : {}),
        responsePreferences: DEFAULT_PERSONAL_PREFERENCES,
        instructions: personalInstructions(DEFAULT_PERSONAL_PREFERENCES),
      },
      toolAllowlist: [...PERSONAL_MAIN_TOOL_IDS],
      skills: { mode: 'replace', include: [] },
      runtime: { thinkingLevel: 'off' },
      models: { chat: { primary: chosen.id, fallbacks: [] } },
    });
  } else if (existing.provisioningState !== 'ready' || existing.models?.chat?.primary !== chosen.id || existing.runtime?.thinkingLevel !== 'off') {
    await catalog.update(agentId, { models: { chat: { primary: chosen.id, fallbacks: [] } }, runtime: { ...existing.runtime, thinkingLevel: 'off' } });
  }
  const record = getPersonalAgent(ownerId);
  if (!record) throw new Error('Personal Agent provisioning did not complete');
  const conversationId = record.conversationId;
  service.refreshAgentCatalog();
  if (!getSessionMetadata(conversationId)) {
    createConversation({
      agentId,
      sourceChannel: 'webchat',
      name: record.displayName,
      hiddenFromSessionList: true,
      customData: { personalAgent: true, keepHiddenFromSessionList: true },
    }, '', conversationId);
  }
  ensurePersonalConversationVisibility(ownerId);
  setSessionConfig(conversationId, { modelOverride: chosen.id, fixedModel: true, thinkingLevel: 'off' }, process.cwd());
  completePersonalOnboarding(ownerId);
  return getPersonalAgent(ownerId) ?? record;
}

export async function patchPersonalProfile(
  service: PersonalAgentHost,
  ownerId: string,
  revision: number,
  displayName: string,
  preferences: PersonalPreferences,
  appearance: PersonalAppearance,
  voicePreference?: { provider: string; model: string; voice: string } | null,
): Promise<PersonalAgentRecord | null> {
  const updated = await updatePersonalProfileRecord(ownerId, revision, displayName, preferences, appearance, voicePreference);
  if (!updated) return null;
  service.refreshAgentCatalog();
  service.agentService.evictSessionAgent(updated.conversationId);
  return updated;
}

export async function updatePersonalProfileRecord(
  ownerId: string,
  revision: number,
  displayName: string,
  preferences: PersonalPreferences,
  appearance: PersonalAppearance,
  voicePreference?: { provider: string; model: string; voice: string } | null,
): Promise<PersonalAgentRecord | null> {
  const repository = new AgentCatalogRepository();
  const current = repository.get(personalAgentId(ownerId));
  if (!current || current.provisioningState !== 'ready' || current.revision !== revision || getPersonalAgent(ownerId)?.state !== 'ready') return null;
  const profile = {
    ...current.profile,
    name: displayName,
    emoji: appearanceEmoji(appearance),
    avatar: appearanceAvatar(appearance),
    ...(voicePreference !== undefined ? { voicePreference: voicePreference ?? undefined } : {}),
    responsePreferences: preferences,
    instructions: personalInstructions(preferences),
  };
  try {
    await new AgentCatalogService().update(current.id, { profile }, revision);
  } catch (error) {
    if (error instanceof Error && error.message === 'Agent revision conflict') return null;
    throw error;
  }
  return getPersonalAgent(ownerId);
}
