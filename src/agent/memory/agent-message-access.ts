import type { AgentMessage } from '@earendil-works/pi-agent-core';

/** Read `content` when present (union includes variants without `content`, e.g. BashExecutionMessage). */
export function readAgentMessageContent(msg: AgentMessage): unknown {
  return (msg as { content?: unknown }).content;
}
