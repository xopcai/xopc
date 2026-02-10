// Extended types for xopcbot agent
import type { AgentMessage as BaseAgentMessage } from '@mariozechner/pi-agent-core';

// Re-export to avoid unused import warning
export type { BaseAgentMessage };

export interface AgentConfig {
  workspace: string;
  model?: string;
  systemPrompt?: string;
}

// Re-export base types
export type { AgentMessage } from '@mariozechner/pi-agent-core';
