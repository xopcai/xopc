import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { replaceAgentSystemPrompt } from '../prompt/agent-system-prompt.js';

export function applySystemPromptOverrideToSession(session: AgentSession, override: string): void {
  const prompt = override.trim();
  const mutableSession = session as unknown as {
    _baseSystemPromptOptions?: Record<string, unknown>;
    _runSystemPromptOptions?: Record<string, unknown>;
    _rebuildSystemPrompt?: (toolNames: string[]) => void;
    _xopcOriginalRebuildSystemPrompt?: (toolNames: string[]) => void;
  };
  const applyOverride = (options: Record<string, unknown> | undefined) => {
    if (options) options.forceSystemPrompt = prompt;
  };
  applyOverride(mutableSession._baseSystemPromptOptions);
  applyOverride(mutableSession._runSystemPromptOptions);

  const originalRebuild = mutableSession._xopcOriginalRebuildSystemPrompt
    ?? mutableSession._rebuildSystemPrompt?.bind(session);
  if (originalRebuild && !mutableSession._xopcOriginalRebuildSystemPrompt) {
    mutableSession._xopcOriginalRebuildSystemPrompt = originalRebuild;
  }
  if (originalRebuild) {
    mutableSession._rebuildSystemPrompt = (toolNames) => {
      const result = originalRebuild(toolNames);
      applyOverride(mutableSession._baseSystemPromptOptions);
      return result;
    };
  }
  replaceAgentSystemPrompt(session.agent, prompt);
}
