import type { Config } from '../../config/schema.js';
import { listChannelPlugins } from '../../channels/plugins/registry.js';
import { PACKAGE_VERSION } from '../../package-version.js';
import { isCronConversationId, isSubagentConversationId, getConversationRouting } from '../../routing/session-key.js';
import type { ProviderSystemPromptContribution } from './contribution.js';
import { normalizePromptSection } from './cache-boundary.js';
import type { MemoryCitationsMode, PromptMode, SilentReplyPromptMode } from './types.js';

export type { RuntimeInfoInput } from './sections/workspace-runtime.js';

export function resolvePromptMode(conversationId?: string): PromptMode {
  if (!conversationId) {
    return 'full';
  }
  if (isSubagentConversationId(conversationId) || isCronConversationId(conversationId)) {
    return 'minimal';
  }
  return 'full';
}

export function resolveRuntimeChannel(conversationId?: string): string | undefined {
  if (!conversationId) {
    return undefined;
  }
  const parsed = getConversationRouting(conversationId);
  return parsed?.source;
}

export function resolveDeliverableChannels(config: Config): string[] {
  const channels = new Set<string>(['webchat', 'cli']);
  const configured = config.channels as Record<string, { enabled?: boolean }> | undefined;
  if (configured) {
    for (const [id, section] of Object.entries(configured)) {
      if (section?.enabled !== false) {
        channels.add(id);
      }
    }
  }
  for (const plugin of listChannelPlugins()) {
    const id = plugin.id;
    const section = configured?.[id];
    if (section?.enabled !== false && section !== undefined) {
      channels.add(id);
    }
  }
  return [...channels].sort();
}

export function normalizeProviderPromptBlock(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = normalizePromptSection(value);
  return normalized || undefined;
}

export function buildOverridablePromptSection(params: {
  override?: string;
  fallback: string;
}): string {
  const override = normalizeProviderPromptBlock(params.override);
  if (override) {
    return override;
  }
  return params.fallback;
}

export interface SystemPromptBuildParams {
  workspaceDir: string;
  conversationId?: string;
  promptMode?: PromptMode;
  toolNames?: string[];
  toolSummaries?: Record<string, string>;
  runtimeInfo?: import('./sections/workspace-runtime.js').RuntimeInfoInput;
  userTimezone?: string;
  channels?: string[];
  memoryCitationsMode?: MemoryCitationsMode;
  includeMemorySection?: boolean;
  heartbeatEnabled?: boolean;
  heartbeatPrompt?: string;
  externalMemoryInstructions?: string;
  ttsSystemHint?: string;
  extraSystemPrompt?: string;
  activeProjectContext?: string;
  silentReplyPromptMode?: SilentReplyPromptMode;
  promptContribution?: ProviderSystemPromptContribution;
  includeProblemSolving?: boolean;
  includeToneSection?: boolean;
}

export function resolveSystemPromptBuildParams(
  config: Config,
  params: {
    workspaceDir: string;
    conversationId?: string;
    toolNames?: string[];
    toolSummaries?: Record<string, string>;
    userTimezone?: string;
    externalMemoryInstructions?: string;
    heartbeatEnabled?: boolean;
    heartbeatPrompt?: string;
    ttsSystemHint?: string;
    extraSystemPrompt?: string;
    activeProjectContext?: string;
    modelRef?: string;
    agentId?: string;
    thinkingLevel?: string;
    promptMode?: PromptMode;
    silentReplyPromptMode?: SilentReplyPromptMode;
    promptContribution?: ProviderSystemPromptContribution;
    memoryCitationsMode?: MemoryCitationsMode;
    includeMemorySection?: boolean;
  },
): SystemPromptBuildParams {
  const conversationId = params.conversationId;
  const channel = resolveRuntimeChannel(conversationId);
  return {
    workspaceDir: params.workspaceDir,
    conversationId,
    promptMode: params.promptMode ?? resolvePromptMode(conversationId),
    toolNames: params.toolNames,
    toolSummaries: params.toolSummaries,
    runtimeInfo: {
      version: PACKAGE_VERSION,
      model: params.modelRef,
      channel,
      agentId: params.agentId,
      thinkingLevel: params.thinkingLevel,
    },
    userTimezone: params.userTimezone,
    channels: resolveDeliverableChannels(config),
    memoryCitationsMode: params.memoryCitationsMode,
    includeMemorySection: params.includeMemorySection,
    heartbeatEnabled: params.heartbeatEnabled,
    heartbeatPrompt: params.heartbeatPrompt,
    externalMemoryInstructions: params.externalMemoryInstructions,
    ttsSystemHint: params.ttsSystemHint,
    extraSystemPrompt: params.extraSystemPrompt,
    activeProjectContext: params.activeProjectContext,
    silentReplyPromptMode: params.silentReplyPromptMode,
    promptContribution: params.promptContribution,
    includeProblemSolving: true,
    includeToneSection: true,
  };
}
