/**
 * System Prompt Builder — xopc-owned prompt with OpenClaw-style bootstrap injection.
 *
 * Profile Markdown under `agents/<id>/profile/` is injected as Project Context
 * (see `src/agent/bootstrap/`). Runtime owns loading; AGENTS.md instructs agents
 * not to manually reread startup files.
 */

import { createHash } from 'node:crypto';

import type { EmbeddedContextFile } from '../bootstrap/types.js';
import { personalInstructions, projectPersonalInstructions } from '../../personal-agent/prompts.js';
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

  const customInstructions = promptRole === 'personal'
    ? projectPersonalInstructions(personalInstructions(), toolNames, responseLanguage === 'en') : storedCustomInstructions;

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

  const isVoice = promptMode === 'voice';
  const isMinimal = promptMode === 'minimal' || isVoice;
  const isPersonal = promptRole === 'personal';
  const normalizedTools = new Set(toolNames.map((tool) => tool.trim().toLowerCase()).filter(Boolean));
  const effectiveAgentId = agentId ?? runtime?.agentId;
  const sectionOverrides = promptContribution?.sectionOverrides ?? {};

  const orderedContextFiles = sortContextFilesForPrompt(
    contextFiles.filter((file) => file.path.trim().length > 0 && !(isPersonal && isStockPersonalTemplate(file))),
  );
  const hasProfileMemory = orderedContextFiles.some(
    (file) => getContextFileBasename(file.path) === 'memory.md',
  );

  const stableSections: string[] = [
    'You are a personal AI assistant running inside xopc.',
    ...(customInstructions?.trim()
      ? [`<custom_instructions>\n${customInstructions.trim()}\n</custom_instructions>`]
      : []),
    // Full tool descriptions are already present in provider schemas; avoid duplicating them in the personal overview.
    buildToolingSection({
      toolNames,
      currentChannel: runtime?.channel,
      toolSummaries: isPersonal && toolSummaries
        ? Object.fromEntries(Object.entries(toolSummaries).map(([name, summary]) =>
            [name, summary.split(/(?<=[.!?])\s+/)[0].slice(0, 300)]))
        : toolSummaries,
    }),
    ...(normalizedTools.size ? [buildOverridablePromptSection({
      override: sectionOverrides.tool_call_style,
      fallback: buildToolCallStyleSection(),
    })] : []),
  ];

  if (isPersonal && normalizedTools.has('personal_task')) {
    stableSections.push(buildPersonalCoordinationSection());
  } else if (!isPersonal && !isMinimal) {
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
  stableSections.push(isMinimal && !isVoice ? 'Device context is data, not permission.'
    : '## Device environment\nDevice context is source data, not permission or execution-host state. Use fresh fields only; settings are not physical location or user preferences. Never fill gaps from server IP or cloud GPS. Transfers require authorized tools.');

  if (actionTrustLevel) {
    stableSections.push(buildActionTrustPrompt(actionTrustLevel));
  }

  if (!isPersonal && effectiveAgentId?.toLowerCase() === 'coder') {
    stableSections.push(buildCoderHarnessSection());
  }

  if (hasSkillsTools(toolNames)) {
    stableSections.push(buildSkillsSection(toolNames));
  }

  if (!isMinimal || isVoice) {
    stableSections.push(
      buildMemorySection({
        availableTools: normalizedTools,
        citationsMode: memoryCitationsMode,
        hasProfileMemory,
        includeMemorySection,
      }),
      buildExternalMemorySection(externalMemoryInstructions),
    );
    if (!isPersonal && includeProblemSolving && !isVoice) {
      stableSections.push(buildProblemSolvingSection(toolNames));
    }
    if (includeToneSection && !isVoice) {
      stableSections.push(buildAestheticSection());
      if (!isPersonal) {
        stableSections.push(buildHumanCollaborationSection(true));
      }
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
    stableSections.push(buildOutputDirectivesSection(isMinimal, toolNames));
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
    const contextHeader = isVoice ? '## Conversation Context' : isMinimal ? '## Subagent Context' : '## Group Chat Context';
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

// Digests of the shipped profile bodies from workspace-templates and docs/reference/templates.
// Keep old digests when a seed changes so existing unedited profiles still match.
const STOCK_PERSONAL_TEMPLATE_DIGESTS = new Map([
  ['agents.md', [
    '10a4e3df43c3fe19568eaaf7b1f3f96a20182501c8a19f7c1ffe1cbb257d376f',
    'b73357279e8f5d21366a937a7a49d7e9322f5dd7f14a085241683251387657c6',
  ]],
  ['soul.md', [
    'a89637ce4be51f9b2ca847df3fe81ef9bfe3ddfb1a233733d4c4a42d31cc00f6',
    'ff1fe8358a29ad774bd89fe6a2d5a8418cb0982b45e7d8e16b0088b043ba8b37',
    'c88eca42a33528b880fdc44baefa02f66b5d76ccec69c27e23d537d3f86a0160',
    '36ea5d9157979ce51cac0730f4fc4402bbe6944ea8f8e30cfca2ea316e7b7e40',
  ]],
  ['tools.md', ['95b55da7511ac7ee54efe6927d8ceb131919f897d45653ff9bb30b04e9d9592b']],
]);

function isStockPersonalTemplate(file: EmbeddedContextFile): boolean {
  const knownDigests = STOCK_PERSONAL_TEMPLATE_DIGESTS.get(getContextFileBasename(file.path));
  if (!knownDigests) return false;
  const body = file.content.replace(/\r\n?/g, '\n').trimEnd();
  return knownDigests.includes(createHash('sha256').update(body).digest('hex'));
}

/** Split a built prompt at the cache boundary (for tests and provider adapters). */
export function splitBuiltSystemPrompt(text: string) {
  return splitPromptCacheBoundary(text);
}
