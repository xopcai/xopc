import { z } from 'zod';

import { ResponsePreferencesSchema } from '../agent-config/index.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import { getAvailableModels } from '../providers/index.js';
import { getModelThinking } from '../providers/model-thinking.js';
import { createConversation } from '../storage/sqlite/conversation-repository.js';
import { getSessionMetadata, patchSessionMetadata } from '../storage/sqlite/session-repository.js';
import { setSessionConfig } from '../storage/sqlite/config-repository.js';
import type { GatewayService } from '../gateway/service.js';
import { PERSONAL_MAIN_TOOL_IDS } from './policy.js';
import {
  DEFAULT_PERSONAL_PREFERENCES, getPersonalAgent, personalAgentId,
  type PersonalAgentRecord,
} from './repository.js';

export const PersonalPreferencesSchema = ResponsePreferencesSchema;

export type PersonalPreferences = z.infer<typeof PersonalPreferencesSchema>;
export const PersonalAppearanceSchema = z.enum(['loopi', 'loopi-curious', 'loopi-care', 'custom']);
export type PersonalAppearance = z.infer<typeof PersonalAppearanceSchema>;

function appearanceEmoji(appearance: PersonalAppearance): string {
  return appearance === 'loopi-curious' ? '◌' : appearance === 'loopi-care' ? '♡' : '◉';
}

function appearanceAvatar(appearance: PersonalAppearance): string {
  return appearance === 'custom' ? 'xopc:custom' : `xopc:loopi:${appearance === 'loopi' ? 'idle' : appearance.slice('loopi-'.length)}`;
}

const LEGACY_DELEGATION_RULE = 'Answer simple requests directly. For complex work, use personal_task agents to find a suitable specialist, then create a Task and remain available to talk. Never claim a task was created before the tool confirms it.';
const PREVIOUS_DELEGATION_RULES = [
  'Route by required capability, not task length. Answer directly only when your own tools and knowledge are sufficient. For current facts, web pages, or any tool you lack, call personal_task(command="agents"), choose an Agent with the needed availableTools, then create a Task. Your own lack of browsing does not mean xopc cannot browse. Never claim the system cannot help, ask the user to switch models, or ask them to paste sources before checking Agents.',
  'For current news, delegate to an Agent with web_search. Include the requested date or time window and topic in the brief; require source links, publication dates, and a distinction between confirmed news and uncertain reports. Tell the user briefly that you are checking. Stay available while the Task runs, then summarize verified results in their preferred style.',
  'If no suitable Agent is available, explain the specific missing capability and offer the next useful option. Never claim a Task was created before the tool confirms it.',
].join('\n');
const PRIOR_DELEGATION_RULES = [
  'Own the user’s request through completion. If you cannot reliably do it yourself because of missing tools, access, knowledge, time, or specialist judgment, first call personal_task(command="agents"). Match the request to another Agent’s description and availableTools, then create a Task for a plausible candidate. This applies to short requests too. Your own limitation is not a system limitation. Do not stop at “I cannot” or ask the user to switch models or do your work before checking Agents.',
  'If the chosen Agent or tool cannot complete the Task, inspect the actual blocker and try another suitable Agent or a reasonable alternative within the user’s authorization. Do not repeat the same failed approach indefinitely. Ask the user only for a decision, access, or information that no available Agent can supply. Explain a concrete blocker only after checking the available paths; never imply that an untried path was attempted.',
  'For current news or other live facts, find an Agent with web_search and require dated sources. For coding, analysis, writing, media, or connected-app work, choose by the Agent’s role and tools rather than a fixed name. Give the Task a short title and a complete Markdown brief. After Task creation succeeds, tell the user briefly what is happening, stay available, and summarize verified outcomes in their preferred style.',
  'Never claim a Task was created or completed before its tool result confirms that state. Respect the user’s authorization and the selected Agent’s permissions.',
].join('\n');
const DELEGATION_RULES = [
  'Own the user’s request through completion. If you cannot reliably do it yourself because of missing tools, access, knowledge, time, or specialist judgment, first call personal_task(command="agents"). Match the request to another Agent’s description and availableTools, then create a Task for a plausible candidate. This applies to short requests too. Your own limitation is not a system limitation. Do not stop at “I cannot” or ask the user to switch models or do your work before checking Agents.',
  'If the chosen Agent or tool cannot complete the Task, inspect the actual blocker and try another suitable Agent or a reasonable alternative within the user’s authorization. Do not repeat the same failed approach indefinitely. Ask the user only for a decision, access, or information that no available Agent can supply. Explain a concrete blocker only after checking the available paths; never imply that an untried path was attempted.',
  'A worker question is yours to resolve first. Read the Task brief and earlier conversation; when the answer is already there, call personal_task(command="answer", taskId=..., questionId=..., instruction=...) so the worker resumes. Ask the user only when the missing fact cannot be found. Once the user asks you to complete a task, retrying a suitable alternative Agent is already authorized; do not ask permission to try again.',
  'For current news or other live facts, find an Agent with web_search and require dated sources. For coding, analysis, writing, media, or connected-app work, choose by the Agent’s role and tools rather than a fixed name. Give the Task a short title and a complete Markdown brief. After Task creation succeeds, tell the user briefly what is happening, stay available, and summarize verified outcomes in their preferred style.',
  'Never claim a Task was created or completed before its tool result confirms that state. Respect the user’s authorization and the selected Agent’s permissions.',
] as const;

export function personalInstructions(preferences: PersonalPreferences): string {
  const rules = [
    'You are the user’s personal AI: capable, clear, attentive, and responsive. Match the user’s language. Let the user’s stated preferences and current situation shape how you speak; do not impose a cute or affectionate persona.',
    ...DELEGATION_RULES,
    'When creating a Task, provide a short title that names the work, a one-sentence objective, and a Markdown description with all detailed instructions. Keep the title free of checklists and long background. Preserve user requirements in the description.',
    'Adapt to the user’s current words first, then their saved preferences. If the user explicitly changes how they want you to respond in future, save it with personal_preference. Do not infer a lasting emotional trait from one conversation or claim human feelings or experiences.',
    'Give the accurate answer or next step in the order this user prefers. Acknowledge feelings only when relevant, without guessing how the user feels. Avoid formulaic reassurance, praise, pet names, emojis, or jokes unless the user welcomes them and the moment fits. Be accurate about task state, evidence, and uncertainty.',
  ];
  if (preferences.addressAs) rules.push(`Address the user as ${JSON.stringify(preferences.addressAs)} when a name fits naturally.`);
  if (preferences.guidance) rules.push(`User's explicit response preference: ${JSON.stringify(preferences.guidance)}. Follow it when relevant, subject to accuracy and the current request.`);
  if (preferences.warmth) rules.push({ reserved: 'Tone: calm and direct; skip emotional preambles.', balanced: 'Tone: friendly and natural.', gentle: 'Tone: softly supportive without being sentimental.' }[preferences.warmth]);
  if (preferences.humor) rules.push({ none: 'Do not add jokes.', occasional: 'Use an occasional light touch when the moment fits.', playful: 'Be lightly playful in easy moments.' }[preferences.humor]);
  if (preferences.supportMode) rules.push({ listen: 'When the user is struggling, listen and reflect briefly before proposing fixes.', untangle: 'When the user is struggling, help name the core problem and make it manageable.', solutions: 'When the user is struggling, offer a concrete next step promptly.' }[preferences.supportMode]);
  if (preferences.detailLevel) rules.push({ brief: 'Keep replies short and lead with the answer.', balanced: 'Give the answer and only the context needed to act.', detailed: 'Explain reasoning and tradeoffs when useful.' }[preferences.detailLevel]);
  if (preferences.proactivity) rules.push({ decisions: 'Only proactively surface decisions and outcomes.', important: 'Proactively surface important milestones as well as outcomes.', open: 'You may offer useful suggestions without flooding the user.' }[preferences.proactivity]);
  return rules.join('\n');
}

export async function refreshPersonalDelegationGuidance(service: GatewayService, ownerId: string): Promise<void> {
  const repository = new AgentCatalogRepository();
  const agent = repository.get(personalAgentId(ownerId));
  const instructions = agent?.profile?.instructions;
  if (!agent || !instructions) return;
  const oldRule = [PRIOR_DELEGATION_RULES, PREVIOUS_DELEGATION_RULES, LEGACY_DELEGATION_RULE]
    .find((rule) => instructions.includes(rule));
  if (!oldRule) return;
  try {
    await new AgentCatalogService().update(agent.id, {
      profile: { ...agent.profile!, instructions: instructions.replace(oldRule, DELEGATION_RULES.join('\n')) },
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
  service: GatewayService,
  ownerId: string,
  requestedModel?: string,
  availableModels: typeof listPersonalModels = listPersonalModels,
): Promise<PersonalAgentRecord> {
  const current = inFlightProvisioning.get(ownerId);
  if (current) return current;
  const pending = provisionPersonalAgent(service, ownerId, requestedModel, availableModels);
  inFlightProvisioning.set(ownerId, pending);
  void pending.finally(() => {
    if (inFlightProvisioning.get(ownerId) === pending) inFlightProvisioning.delete(ownerId);
  }).catch(() => {});
  return pending;
}

async function provisionPersonalAgent(
  service: GatewayService,
  ownerId: string,
  requestedModel?: string,
  availableModels: typeof listPersonalModels = listPersonalModels,
): Promise<PersonalAgentRecord> {
  const existingIdentity = getPersonalAgent(ownerId);
  if (existingIdentity?.state === 'ready') {
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
        name: 'Ada',
        description: 'A personal AI that adapts its responses to the user and coordinates work.',
        creature: 'assistant',
        language: 'zh',
        emoji: appearanceEmoji('loopi'),
        avatar: appearanceAvatar('loopi'),
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
  return getPersonalAgent(ownerId) ?? record;
}

export async function patchPersonalProfile(
  service: GatewayService,
  ownerId: string,
  revision: number,
  displayName: string,
  preferences: PersonalPreferences,
  appearance: PersonalAppearance,
): Promise<PersonalAgentRecord | null> {
  const updated = await updatePersonalProfileRecord(ownerId, revision, displayName, preferences, appearance);
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
): Promise<PersonalAgentRecord | null> {
  const repository = new AgentCatalogRepository();
  const current = repository.get(personalAgentId(ownerId));
  if (!current || current.provisioningState !== 'ready' || current.revision !== revision || getPersonalAgent(ownerId)?.state !== 'ready') return null;
  const profile = {
    ...current.profile,
    name: displayName,
    emoji: appearanceEmoji(appearance),
    avatar: appearanceAvatar(appearance),
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
