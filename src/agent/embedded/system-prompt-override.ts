import type { AgentSession } from '@earendil-works/pi-coding-agent';

export function applySystemPromptOverrideToSession(session: AgentSession, override: string): void {
  const prompt = override.trim();
  session.agent.state.systemPrompt = prompt;
  const mutableSession = session as unknown as {
    _baseSystemPrompt?: string;
    _rebuildSystemPrompt?: (toolNames: string[]) => string;
  };
  mutableSession._baseSystemPrompt = prompt;
  mutableSession._rebuildSystemPrompt = () => prompt;
}
