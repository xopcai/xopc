/**
 * System Prompt Builder — xopc-owned prompt with OpenClaw-style bootstrap injection.
 *
 * Profile Markdown under `agents/<id>/profile/` is injected as Project Context
 * (see `src/agent/bootstrap/`). Runtime owns loading; AGENTS.md instructs agents
 * not to manually reread startup files.
 */

import type { EmbeddedContextFile } from '../bootstrap/types.js';
import { projectPersonalInstructions } from '../../personal-agent/prompts.js';
import type { AgentProfile } from '../../agent-config/index.js';
import type { ResponseLanguage } from '../../i18n/response-language.js';
import { buildActionTrustPrompt, type UserTrustLevel } from '../../user-context/trust-policy.js';
import { PROMPT_CACHE_BOUNDARY, splitPromptCacheBoundary } from './cache-boundary.js';
import type { ProviderSystemPromptContribution } from './contribution.js';
import {
  buildAestheticSection,
  buildExecutionBiasSection,
  buildHumanCollaborationSection,
  buildProblemSolvingSection,
  buildPersonalCoordinationSection,
  buildSafetySection,
  buildToolCallStyleSection,
  buildWorkContinuitySection,
} from './sections/behavior.js';
import {
  buildExternalMemorySection,
  buildMemorySection,
  buildSkillsSection,
} from './sections/memory-skills.js';
import {
  buildMessagingSection,
  buildOutputDirectivesSection,
  buildSilentRepliesSection,
  buildTimeSection,
} from './sections/messaging-runtime.js';
import {
  buildProjectContextSection,
  getContextFileBasename,
  sortContextFilesForPrompt,
} from './sections/project-context.js';
import { buildToolingSection, hasSkillsTools } from './sections/tooling.js';
import {
  buildRuntimeSection,
  buildWorkspaceFilesIntroSection,
  buildWorkspaceSection,
  type RuntimeInfoInput,
} from './sections/workspace-runtime.js';
import { buildResponseLanguageSection } from './sections/response-language.js';
import { buildAgentIdentitySection } from './sections/agent-identity.js';
import { buildOverridablePromptSection } from './system-prompt-params.js';
import type { MemoryCitationsMode, PromptMode, PromptRole, SilentReplyPromptMode } from './types.js';

export type { MemoryCitationsMode } from './types.js';
export {
  getContextFileBasename,
  sortContextFilesForPrompt,
} from './sections/project-context.js';

export interface SystemPromptOptions {
  contextFiles?: EmbeddedContextFile[];
  promptMode?: PromptMode;
  promptRole?: PromptRole;
  /** Registered tool names for Tooling section and memory/skills gating. */
  toolNames?: string[];
  toolSummaries?: Record<string, string>;
  memoryCitationsMode?: MemoryCitationsMode;
  includeMemorySection?: boolean;
  userTimezone?: string;
  runtime?: RuntimeInfoInput;
  agentId?: string;
  channels?: string[];
  externalMemoryInstructions?: string;
  ttsSystemHint?: string;
  extraSystemPrompt?: string;
  activeProjectContext?: string;
  silentReplyPromptMode?: SilentReplyPromptMode;
  promptContribution?: ProviderSystemPromptContribution;
  includeProblemSolving?: boolean;
  includeToneSection?: boolean;
  actionTrustLevel?: UserTrustLevel;
  responseLanguage?: ResponseLanguage;
  customInstructions?: string;
  agentProfile?: AgentProfile;
}

function joinSections(sections: Array<string | undefined>): string {
  return sections.filter((section): section is string => Boolean(section?.trim())).join('\n\n');
}

/**
 * Build system prompt with bootstrap Project Context integration.
 */
export function buildSystemPrompt(workspaceDir: string, options: SystemPromptOptions = {}): string {
  const {
    contextFiles = [],
    promptMode = 'full',
    promptRole = 'executor',
    toolNames = [],
    toolSummaries,
    memoryCitationsMode = 'on',
    includeMemorySection,
    userTimezone,
    runtime,
    agentId,
    channels = [],
    externalMemoryInstructions,
    ttsSystemHint,
    extraSystemPrompt,
    activeProjectContext,
    silentReplyPromptMode = 'generic',
    promptContribution,
    includeProblemSolving = true,
    includeToneSection = true,
    actionTrustLevel,
    responseLanguage = 'auto',
    customInstructions: storedCustomInstructions,
    agentProfile,
  } = options;

  const customInstructions = promptRole === 'personal' && storedCustomInstructions
    ? projectPersonalInstructions(storedCustomInstructions, toolNames) : storedCustomInstructions;

  if (promptMode === 'none') {
    return joinSections([
      'You are a personal AI assistant running inside xopc.',
      customInstructions?.trim()
        ? `<custom_instructions>\n${customInstructions.trim()}\n</custom_instructions>`
        : undefined,
      activeProjectContext,
      buildAgentIdentitySection(agentProfile),
      buildResponseLanguageSection(responseLanguage, agentProfile?.language),
    ]);
  }

  const isMinimal = promptMode === 'minimal';
  const isPersonal = promptRole === 'personal';
  const normalizedTools = new Set(toolNames.map((tool) => tool.trim().toLowerCase()).filter(Boolean));
  const effectiveAgentId = agentId ?? runtime?.agentId;
  const sectionOverrides = promptContribution?.sectionOverrides ?? {};

  const orderedContextFiles = sortContextFilesForPrompt(
    contextFiles.filter((file) => file.path.trim().length > 0),
  );
  const hasProfileMemory = orderedContextFiles.some(
    (file) => getContextFileBasename(file.path) === 'memory.md',
  );

  const stableSections: string[] = [
    'You are a personal AI assistant running inside xopc.',
    ...(customInstructions?.trim()
      ? [`<custom_instructions>\n${customInstructions.trim()}\n</custom_instructions>`]
      : []),
    buildToolingSection({ toolNames, toolSummaries }),
    ...(normalizedTools.size ? [buildOverridablePromptSection({
      override: sectionOverrides.tool_call_style,
      fallback: buildToolCallStyleSection(),
    })] : []),
  ];

  if (isPersonal) {
    stableSections.push(buildPersonalCoordinationSection());
  } else if (!isMinimal) {
    stableSections.push(
      buildOverridablePromptSection({
        override: sectionOverrides.execution_bias,
        fallback: buildExecutionBiasSection(),
      }),
    );
  }

  const providerStablePrefix = buildOverridablePromptSection({
    override: promptContribution?.stablePrefix,
    fallback: '',
  });
  if (providerStablePrefix) {
    stableSections.push(providerStablePrefix);
  }

  stableSections.push(buildSafetySection());

  if (actionTrustLevel) {
    stableSections.push(buildActionTrustPrompt(actionTrustLevel));
  }

  if (!isPersonal && effectiveAgentId?.toLowerCase() === 'coder') {
    stableSections.push(buildCoderHarnessSection());
  }

  if (hasSkillsTools(toolNames)) {
    stableSections.push(buildSkillsSection(toolNames));
  }

  if (!isMinimal) {
    stableSections.push(
      buildMemorySection({
        availableTools: normalizedTools,
        citationsMode: memoryCitationsMode,
        hasProfileMemory,
        includeMemorySection,
      }),
      buildExternalMemorySection(externalMemoryInstructions),
    );
    if (!isPersonal && includeProblemSolving) {
      stableSections.push(buildProblemSolvingSection(toolNames));
    }
    if (includeToneSection) {
      stableSections.push(buildAestheticSection(), buildHumanCollaborationSection(!isPersonal));
    }
    if (!isPersonal && (normalizedTools.has('xopc_use') || normalizedTools.has('automation'))) {
      stableSections.push(buildWorkContinuitySection());
    }
    stableSections.push(buildTimeSection(userTimezone, toolNames));
  }

  stableSections.push(
    buildWorkspaceSection(workspaceDir),
    ...(orderedContextFiles.length ? [buildWorkspaceFilesIntroSection()] : []),
  );

  if (!isMinimal) {
    stableSections.push(buildOutputDirectivesSection(isMinimal, toolNames, channels));
  }

  stableSections.push(
    buildMessagingSection({
      channels,
      isMinimal,
      hasSendMessage: normalizedTools.has('send_message'),
    }),
  );

  if (!isMinimal && ttsSystemHint?.trim()) {
    stableSections.push(`## Voice (TTS)\n\n${ttsSystemHint.trim()}`);
  }

  stableSections.push(
    joinSections(
      buildProjectContextSection({
        files: orderedContextFiles,
        heading: '# Project Context',
      }),
    ),
  );

  if (!isMinimal) {
    stableSections.push(
      buildSilentRepliesSection({ isMinimal, silentReplyPromptMode, hasSendMessage: normalizedTools.has('send_message') }),
    );
  }

  const dynamicSections: string[] = [];

  if (extraSystemPrompt?.trim()) {
    const contextHeader = isMinimal ? '## Subagent Context' : '## Group Chat Context';
    dynamicSections.push(`${contextHeader}\n\n${extraSystemPrompt.trim()}`);
  }

  if (activeProjectContext?.trim()) {
    dynamicSections.push(activeProjectContext.trim());
  }

  const providerDynamicSuffix = buildOverridablePromptSection({
    override: promptContribution?.dynamicSuffix,
    fallback: '',
  });
  if (providerDynamicSuffix) {
    dynamicSections.push(providerDynamicSuffix);
  }

  dynamicSections.push(
    buildRuntimeSection(runtime),
    buildAgentIdentitySection(agentProfile) ?? '',
    buildResponseLanguageSection(responseLanguage, agentProfile?.language),
  );

  const stablePrefix = joinSections(stableSections);
  const dynamicSuffix = joinSections(dynamicSections);

  if (!dynamicSuffix.trim()) {
    return `${stablePrefix}\n\n${PROMPT_CACHE_BOUNDARY}`.trim();
  }

  return `${stablePrefix}\n\n${PROMPT_CACHE_BOUNDARY}\n\n${dynamicSuffix}`.trim();
}

function buildCoderHarnessSection(): string {
  return [
    '## Coder Harness',
    '- Inspect relevant repository instructions, files, symbols, tests, and call sites before editing.',
    '- Make the smallest coherent source change that solves the requested behavior.',
    '- Protect user work: do not discard or overwrite unrelated changes.',
    '- After edits, inspect the diff and run the smallest meaningful verification; explain any skipped checks.',
  ].join('\n');
}

/** Split a built prompt at the cache boundary (for tests and provider adapters). */
export function splitBuiltSystemPrompt(text: string) {
  return splitPromptCacheBoundary(text);
}
