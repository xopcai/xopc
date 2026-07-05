/**
 * System Prompt Builder - Builds the complete system prompt
 *
 * Combines base system prompt with skill prompts and bootstrap Project Context.
 */

import type { Config } from '../../config/schema.js';
import type { EmbeddedContextFile } from '../bootstrap/types.js';
import type { SkillManager } from '../skills/skill-manager.js';
import { buildSystemPrompt as buildBaseSystemPrompt } from './system-prompt.js';
import { resolveSystemPromptBuildParams } from './system-prompt-params.js';
import type { PromptMode, SilentReplyPromptMode } from './types.js';
import type { ProviderSystemPromptContribution } from './contribution.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { buildTtsSystemPromptHint } from '../../voice/tts/directives.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SystemPromptBuilder');

export interface SystemPromptBuildOptions {
  externalMemoryInstructions?: string;
  workspaceOverride?: string;
  profileMarkdownPathRoot?: string;
  systemPromptOverride?: string;
  skillPromptText?: string;
  skillAllowlist?: string[];
  registeredToolNames?: string[];
  toolSummaries?: Record<string, string>;
  sessionKey?: string;
  promptMode?: PromptMode;
  modelRef?: string;
  agentId?: string;
  thinkingLevel?: string;
  extraSystemPrompt?: string;
  silentReplyPromptMode?: SilentReplyPromptMode;
  promptContribution?: ProviderSystemPromptContribution;
}

export interface SystemPromptBuilderConfig {
  workspace: string;
  config: Config;
  skillManager: SkillManager;
}

export class SystemPromptBuilder {
  private workspace: string;
  private config: Config;
  private skillManager: SkillManager;

  constructor(config: SystemPromptBuilderConfig) {
    this.workspace = config.workspace;
    this.config = config.config;
    this.skillManager = config.skillManager;
  }

  build(contextFiles: EmbeddedContextFile[], options: SystemPromptBuildOptions): string {
    const ws = options.workspaceOverride ?? this.workspace;
    if (options.systemPromptOverride?.trim()) {
      const skillPrompt =
        options.skillPromptText !== undefined
          ? options.skillPromptText
          : this.skillManager.getPromptForSkillAllowlist(
              options.skillAllowlist,
              options.registeredToolNames,
            );
      const trimmed = options.systemPromptOverride.trim();
      let fullPrompt = skillPrompt.trim() ? `${trimmed}\n\n${skillPrompt}` : trimmed;
      const ttsMerged = mergeTtsConfigFromAppConfig(this.config.messages?.tts);
      const reg = options.registeredToolNames ?? [];
      const ttsHint = buildTtsSystemPromptHint({
        enabled: ttsMerged.enabled,
        trigger: ttsMerged.trigger,
        maxTextLength: ttsMerged.maxTextLength,
        modelOverrides: ttsMerged.modelOverrides,
        textToSpeechTool: ttsMerged.enabled && reg.includes('text_to_speech'),
      });
      if (ttsHint?.trim()) {
        fullPrompt = `${fullPrompt}\n\n## Voice (TTS)\n\n${ttsHint.trim()}`;
      }
      log.debug({ baseLength: trimmed.length, skillLength: skillPrompt.length, totalLength: fullPrompt.length }, 'System prompt built (override)');
      return fullPrompt;
    }

    const heartbeatEnabled = this.config.gateway?.heartbeat?.includeSystemPromptSection ?? false;
    const userTimezone = this.extractTimezone(contextFiles);

    const ttsMerged = mergeTtsConfigFromAppConfig(this.config.messages?.tts);
    const reg = options.registeredToolNames ?? [];
    const ttsSystemHint = buildTtsSystemPromptHint({
      enabled: ttsMerged.enabled,
      trigger: ttsMerged.trigger,
      maxTextLength: ttsMerged.maxTextLength,
      modelOverrides: ttsMerged.modelOverrides,
      textToSpeechTool: ttsMerged.enabled && reg.includes('text_to_speech'),
    });

    const resolved = resolveSystemPromptBuildParams(this.config, {
      workspaceDir: ws,
      sessionKey: options.sessionKey,
      toolNames: options.registeredToolNames,
      toolSummaries: options.toolSummaries,
      userTimezone,
      externalMemoryInstructions: options.externalMemoryInstructions,
      heartbeatEnabled,
      ttsSystemHint,
      extraSystemPrompt: options.extraSystemPrompt,
      modelRef: options.modelRef,
      agentId: options.agentId,
      thinkingLevel: options.thinkingLevel,
      promptMode: options.promptMode,
      silentReplyPromptMode: options.silentReplyPromptMode,
      promptContribution: options.promptContribution,
    });

    const basePrompt = buildBaseSystemPrompt(ws, {
      contextFiles,
      promptMode: resolved.promptMode,
      heartbeatEnabled: resolved.heartbeatEnabled,
      heartbeatPrompt: resolved.heartbeatPrompt,
      toolNames: resolved.toolNames,
      toolSummaries: resolved.toolSummaries,
      memoryCitationsMode: resolved.memoryCitationsMode,
      includeMemorySection: resolved.includeMemorySection,
      userTimezone: resolved.userTimezone,
      runtime: resolved.runtimeInfo,
      agentId: options.agentId,
      channels: resolved.channels,
      externalMemoryInstructions: resolved.externalMemoryInstructions,
      ttsSystemHint: resolved.ttsSystemHint,
      extraSystemPrompt: resolved.extraSystemPrompt,
      silentReplyPromptMode: resolved.silentReplyPromptMode,
      promptContribution: resolved.promptContribution,
      includeProblemSolving: resolved.includeProblemSolving,
      includeToneSection: resolved.includeToneSection,
    });

    const skillPrompt =
      options.skillPromptText !== undefined
        ? options.skillPromptText
        : this.skillManager.getPromptForSkillAllowlist(
            options.skillAllowlist,
            options.registeredToolNames,
          );

    const fullPrompt = skillPrompt ? `${basePrompt}\n\n${skillPrompt}` : basePrompt;

    log.debug(
      {
        baseLength: basePrompt.length,
        skillLength: skillPrompt?.length || 0,
        totalLength: fullPrompt.length,
        contextFileCount: contextFiles.length,
        promptMode: resolved.promptMode,
        toolCount: resolved.toolNames?.length ?? 0,
      },
      'System prompt built',
    );

    return fullPrompt;
  }

  rebuild(contextFiles: EmbeddedContextFile[], options: SystemPromptBuildOptions): string {
    this.skillManager.reload();
    return this.build(contextFiles, options);
  }

  private extractTimezone(contextFiles: EmbeddedContextFile[]): string | undefined {
    const userContext = contextFiles.find((file) =>
      file.path.replace(/\\/g, '/').toLowerCase().endsWith('/user/profile.md'),
    );
    if (userContext?.content) {
      const match = userContext.content.match(/Timezone:\s*(.+)/i);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  getSkillPrompt(): string {
    return this.skillManager.getPrompt();
  }

  getBasePrompt(
    contextFiles: EmbeddedContextFile[],
    options?: {
      externalMemoryInstructions?: string;
      workspaceOverride?: string;
      profileMarkdownPathRoot?: string;
      registeredToolNames?: string[];
      sessionKey?: string;
    },
  ): string {
    const ws = options?.workspaceOverride ?? this.workspace;
    const resolved = resolveSystemPromptBuildParams(this.config, {
      workspaceDir: ws,
      sessionKey: options?.sessionKey,
      toolNames: options?.registeredToolNames,
      userTimezone: this.extractTimezone(contextFiles),
      externalMemoryInstructions: options?.externalMemoryInstructions,
      heartbeatEnabled: this.config.gateway?.heartbeat?.includeSystemPromptSection ?? false,
    });
    return buildBaseSystemPrompt(ws, {
      contextFiles,
      promptMode: resolved.promptMode,
      heartbeatEnabled: resolved.heartbeatEnabled,
      toolNames: resolved.toolNames,
      userTimezone: resolved.userTimezone,
      runtime: resolved.runtimeInfo,
      channels: resolved.channels,
      externalMemoryInstructions: resolved.externalMemoryInstructions,
    });
  }
}

export function createSystemPromptBuilder(config: SystemPromptBuilderConfig): SystemPromptBuilder {
  return new SystemPromptBuilder(config);
}

export type { SystemPromptBuilderConfig as SystemPromptConfig };
export type { SystemPromptBuilderConfig as SystemPromptBuilderOptions };
