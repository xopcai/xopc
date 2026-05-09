import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../../config/schema.js';
import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { getApiKeySync } from '../../providers/index.js';
import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';
import { createLogger } from '../../utils/logger.js';

import { extractTextContent } from '../context/workspace.js';
import type { BuiltinMemoryStore } from '../memory/builtin-memory-store.js';
import { shouldRegisterCuratedMemoryTool } from '../memory/memory-config.js';
import type { MemoryManager } from '../memory/manager.js';
import {
  runAgentTurnWithTimeout,
  resolveAgentTurnTimeoutMs,
} from '../orchestration/run-agent-turn-with-timeout.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
} from '../orchestration/llm-turn-retry.js';
import type { SkillManager } from '../skills/skill-manager.js';
import { createCuratedMemoryTool } from '../tools/curated-memory-tool.js';
import { createSkillManageTool } from '../tools/skill-manage-tool.js';
import { createSkillsListTool, createSkillViewTool } from '../tools/skills-tools.js';
import { wrapToolsWithProtection } from '../tools/executor.js';

import type { BackgroundReviewSettings } from './settings.js';
import {
  COMBINED_REVIEW_USER_PROMPT,
  MEMORY_REVIEW_USER_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  SKILL_REVIEW_USER_PROMPT,
} from './prompts.js';

const log = createLogger('BackgroundReview');

function cloneMessageTail(messages: AgentMessage[], max: number): AgentMessage[] {
  const tail = messages.length <= max ? messages : messages.slice(-max);
  return JSON.parse(JSON.stringify(tail)) as AgentMessage[];
}

export interface RunBackgroundReviewParams {
  sessionKey: string;
  mainAgent: Agent;
  settings: BackgroundReviewSettings;
  reviewMemory: boolean;
  reviewSkills: boolean;
  registeredToolNames: string[];
  skillAllowlist?: string[];
  workspacePath: string;
  skillManager: SkillManager;
  builtinMemoryStore: BuiltinMemoryStore;
  memoryManager: MemoryManager;
  getConfig: () => Config | undefined;
  onSkillsFilesystemMutate: () => void;
}

export async function runBackgroundReviewTurn(params: RunBackgroundReviewParams): Promise<void> {
  const {
    sessionKey,
    mainAgent,
    settings,
    reviewMemory,
    reviewSkills,
    registeredToolNames,
    skillAllowlist,
    workspacePath,
    skillManager,
    builtinMemoryStore,
    memoryManager,
    getConfig,
    onSkillsFilesystemMutate,
  } = params;

  const userPrompt =
    reviewMemory && reviewSkills
      ? COMBINED_REVIEW_USER_PROMPT
      : reviewMemory
        ? MEMORY_REVIEW_USER_PROMPT
        : SKILL_REVIEW_USER_PROMPT;

  const rawTools: any[] = [];

  if (reviewMemory && shouldRegisterCuratedMemoryTool(getConfig())) {
    rawTools.push(
      createCuratedMemoryTool(() => builtinMemoryStore, {
        onMemoryWrite: (action, target, content) => {
          memoryManager.onMemoryWrite(action, target, content);
        },
      }),
    );
  }

  if (reviewSkills) {
    const ctx = () => ({ registeredToolNames, skillAllowlist });
    rawTools.push(
      createSkillsListTool({
        getSkillManager: () => skillManager,
        getSkillIndexingContext: ctx,
      }),
      createSkillViewTool({
        getSkillManager: () => skillManager,
        getSkillIndexingContext: ctx,
      }),
      createSkillManageTool({
        getSkillManager: () => skillManager,
        getWorkspace: () => workspacePath,
        onSkillsFilesystemMutate,
      }),
    );
  }

  if (rawTools.length === 0) {
    log.debug({ sessionKey }, 'Background review skipped: no tools registered for selected channels');
    return;
  }

  const tools = wrapToolsWithProtection(rawTools, {});

  const model = mainAgent.state.model as Model<Api>;
  let toolRounds = 0;
  let aborted = false;

  const reviewAgent = new Agent({
    initialState: {
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      model,
      thinkingLevel: 'off' as ThinkingLevel,
      tools,
      messages: [],
    },
    streamFn: createExtensionAwareStreamFn(),
    getApiKey: (provider: string) =>
      resolveProviderApiKeySync(provider) ?? getApiKeySync(provider) ?? '',
    beforeToolCall: async () => {
      if (aborted) {
        return { block: true, reason: 'Background review aborted.' };
      }
      if (toolRounds >= settings.maxToolRounds) {
        return {
          block: true,
          reason: `Background review reached max tool rounds (${settings.maxToolRounds}).`,
        };
      }
      return undefined;
    },
    afterToolCall: async () => {
      toolRounds += 1;
      return undefined;
    },
  });

  reviewAgent.state.messages = cloneMessageTail(mainAgent.state.messages, settings.maxHistoryMessages);

  const timeoutMs = Math.min(settings.maxDurationMs, resolveAgentTurnTimeoutMs(getConfig()));

  try {
    await runAgentTurnWithTimeout(
      reviewAgent,
      async () => {
        await reviewAgent.prompt({
          role: 'user',
          content: userPrompt,
          timestamp: Date.now(),
        });
        await reviewAgent.waitForIdle();
      },
      timeoutMs,
    );
  } catch (err) {
    log.warn({ err, sessionKey }, 'Background review turn failed or timed out');
    aborted = true;
    reviewAgent.abort();
    await reviewAgent.waitForIdle().catch(() => {});
    return;
  }

  if (isAssistantTurnAborted(reviewAgent) || isAssistantTurnFailed(reviewAgent)) {
    log.debug({ sessionKey }, 'Background review produced aborted/failed assistant turn');
    return;
  }

  const last = reviewAgent.state.messages;
  for (let i = last.length - 1; i >= 0; i--) {
    const msg = last[i];
    if (msg.role === 'assistant') {
      const content = msg.content;
      const text = Array.isArray(content)
        ? extractTextContent(content as Array<{ type: string; text?: string }>)
        : String(content);
      const trimmed = text.trim();
      if (trimmed && !/^nothing to save\.?$/i.test(trimmed)) {
        log.info({ sessionKey, preview: trimmed.slice(0, 120) }, 'Background review completed');
      } else {
        log.debug({ sessionKey }, 'Background review: nothing to save');
      }
      return;
    }
  }
}
