import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import { getCurrentSystemMessage } from '@earendil-works/pi-ai';

/** Replace the replayed prompt while preserving the transcript's current tool declarations. */
export function replaceAgentSystemPrompt(agent: Agent, systemPrompt: string): void {
  const messages = agent.state.messages;
  const current = getCurrentSystemMessage(messages);
  const systemMessage = {
    role: 'system' as const,
    content: systemPrompt,
    ...(current?.toolsAdded ? { toolsAdded: current.toolsAdded } : {}),
    timestamp: current?.timestamp ?? Date.now(),
  };
  agent.state.messages = [
    systemMessage,
    ...messages.filter((message) => message.role !== 'system'),
  ] as AgentMessage[];
}
