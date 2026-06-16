/**
 * System Prompt Builder — xopc-owned prompt with OpenClaw-style bootstrap injection.
 *
 * Profile Markdown under `agents/<id>/profile/` is injected as Project Context
 * (see `src/agent/bootstrap/`). Runtime owns loading; AGENTS.md instructs agents
 * not to manually reread startup files.
 */

import type { EmbeddedContextFile } from '../bootstrap/types.js';
import { PROMPT_CACHE_BOUNDARY, splitPromptCacheBoundary } from './cache-boundary.js';
import type { ProviderSystemPromptContribution } from './contribution.js';
import {
  buildAestheticSection,
  buildExecutionBiasSection,
  buildProblemSolvingSection,
  buildSafetySection,
  buildToolCallStyleSection,
} from './sections/behavior.js';
import {
  buildExternalMemorySection,
  buildMemorySection,
  buildSkillsSection,
} from './sections/memory-skills.js';
import {
  buildHeartbeatBehaviorSection,
  buildMessagingSection,
  buildOutputDirectivesSection,
  buildSilentRepliesSection,
  buildTimeSection,
} from './sections/messaging-runtime.js';
import {
  buildProjectContextSection,
  getContextFileBasename,
  isDynamicContextFile,
  sortContextFilesForPrompt,
} from './sections/project-context.js';
import { buildToolingSection, hasSkillsTools } from './sections/tooling.js';
import {
  buildRuntimeSection,
  buildWorkspaceFilesIntroSection,
  buildWorkspaceSection,
  type RuntimeInfoInput,
} from './sections/workspace-runtime.js';
import { buildOverridablePromptSection } from './system-prompt-params.js';
import type { MemoryCitationsMode, PromptMode, SilentReplyPromptMode } from './types.js';

export type { MemoryCitationsMode } from './types.js';
export {
  getContextFileBasename,
  isDynamicContextFile,
  sortContextFilesForPrompt,
} from './sections/project-context.js';

export interface SystemPromptOptions {
  contextFiles?: EmbeddedContextFile[];
  promptMode?: PromptMode;
  heartbeatEnabled?: boolean;
  heartbeatPrompt?: string;
  /** Registered tool names for Tooling section and memory/skills gating. */
  toolNames?: string[];
  toolSummaries?: Record<string, string>;
  /** @deprecated Prefer toolNames — kept for skill-section gating compatibility. */
  availableTools?: string[];
  memoryCitationsMode?: MemoryCitationsMode;
  includeMemorySection?: boolean;
  userTimezone?: string;
  runtime?: RuntimeInfoInput;
  channels?: string[];
  externalMemoryInstructions?: string;
  ttsSystemHint?: string;
  extraSystemPrompt?: string;
  silentReplyPromptMode?: SilentReplyPromptMode;
  promptContribution?: ProviderSystemPromptContribution;
  includeProblemSolving?: boolean;
  includeToneSection?: boolean;
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
    heartbeatEnabled = false,
    heartbeatPrompt,
    toolNames: toolNamesOption,
    toolSummaries,
    availableTools = [],
    memoryCitationsMode = 'on',
    includeMemorySection,
    userTimezone,
    runtime,
    channels = [],
    externalMemoryInstructions,
    ttsSystemHint,
    extraSystemPrompt,
    silentReplyPromptMode = 'generic',
    promptContribution,
    includeProblemSolving = true,
    includeToneSection = true,
  } = options;

  if (promptMode === 'none') {
    return 'You are a personal AI assistant running inside xopc.';
  }

  const isMinimal = promptMode === 'minimal';
  const toolNames = toolNamesOption ?? availableTools;
  const normalizedTools = new Set(toolNames.map((tool) => tool.toLowerCase()));
  const sectionOverrides = promptContribution?.sectionOverrides ?? {};

  const orderedContextFiles = sortContextFilesForPrompt(
    contextFiles.filter((file) => file.path.trim().length > 0),
  );
  const stableContextFiles = orderedContextFiles.filter((file) => !isDynamicContextFile(file.path));
  const dynamicContextFiles = orderedContextFiles.filter((file) => isDynamicContextFile(file.path));
  const hasProfileMemory = orderedContextFiles.some(
    (file) => getContextFileBasename(file.path) === 'memory.md',
  );

  const stableSections: string[] = [
    'You are a personal AI assistant running inside xopc.',
    buildToolingSection({ toolNames, toolSummaries }),
    buildOverridablePromptSection({
      override: sectionOverrides.tool_call_style,
      fallback: buildToolCallStyleSection(),
    }),
  ];

  if (!isMinimal) {
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

  if (hasSkillsTools(toolNames)) {
    stableSections.push(buildSkillsSection(true));
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
    if (includeProblemSolving) {
      stableSections.push(buildProblemSolvingSection());
    }
    if (includeToneSection) {
      stableSections.push(buildAestheticSection());
    }
    stableSections.push(buildTimeSection(userTimezone));
  }

  stableSections.push(
    buildWorkspaceSection(workspaceDir),
    buildWorkspaceFilesIntroSection(),
  );

  if (!isMinimal) {
    stableSections.push(buildOutputDirectivesSection(isMinimal));
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
        files: stableContextFiles,
        heading: '# Project Context',
        dynamic: false,
      }),
    ),
  );

  if (!isMinimal) {
    stableSections.push(
      buildSilentRepliesSection({ isMinimal, silentReplyPromptMode }),
    );
  }

  const dynamicSections: string[] = [];

  dynamicSections.push(
    joinSections(
      buildProjectContextSection({
        files: dynamicContextFiles,
        heading: stableContextFiles.length > 0 ? '# Dynamic Project Context' : '# Project Context',
        dynamic: true,
      }),
    ),
  );

  if (extraSystemPrompt?.trim()) {
    const contextHeader = isMinimal ? '## Subagent Context' : '## Group Chat Context';
    dynamicSections.push(`${contextHeader}\n\n${extraSystemPrompt.trim()}`);
  }

  const providerDynamicSuffix = buildOverridablePromptSection({
    override: promptContribution?.dynamicSuffix,
    fallback: '',
  });
  if (providerDynamicSuffix) {
    dynamicSections.push(providerDynamicSuffix);
  }

  dynamicSections.push(
    buildHeartbeatBehaviorSection({
      enabled: heartbeatEnabled,
      customPrompt: heartbeatPrompt,
      userTimezone,
    }),
    buildRuntimeSection(runtime),
  );

  const stablePrefix = joinSections(stableSections);
  const dynamicSuffix = joinSections(dynamicSections);

  if (!dynamicSuffix.trim()) {
    return `${stablePrefix}\n\n${PROMPT_CACHE_BOUNDARY}`.trim();
  }

  return `${stablePrefix}\n\n${PROMPT_CACHE_BOUNDARY}\n\n${dynamicSuffix}`.trim();
}

/** Split a built prompt at the cache boundary (for tests and provider adapters). */
export function splitBuiltSystemPrompt(text: string) {
  return splitPromptCacheBoundary(text);
}
