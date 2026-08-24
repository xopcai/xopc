import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

export type SideChatStatus = 'idle' | 'running' | 'waiting-approval' | 'waiting-input' | 'closing';

export type SideChatSelection =
  | {
      id: string;
      type: 'message';
      messageId: string;
      role: string;
      content: string;
      label?: string;
    }
  | {
      id: string;
      type: 'text';
      text: string;
      sourceMessageId?: string;
      label?: string;
    }
  | {
      id: string;
      type: 'file-range';
      path: string;
      startLine: number;
      endLine: number;
      text: string;
      contentHash?: string;
      label?: string;
    }
  | {
      id: string;
      type: 'diff';
      diff: string;
      path?: string;
      label?: string;
    };

export interface SideChatContextSnapshot {
  parentSessionKey: string;
  parentSessionId: string;
  parentMessageCount: number;
  createdAt: string;
  selections: SideChatSelection[];
  contentHash: string;
}

export interface SideChatConfig {
  modelRef: string;
  thinkingLevel?: ThinkingLevel;
}

export interface SideChatView {
  id: string;
  parentSessionKey: string;
  clientInstanceId: string;
  status: SideChatStatus;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  messageCount: number;
  context: SideChatContextSnapshot;
  config: SideChatConfig;
}

export interface CreateSideChatInput {
  parentSessionKey: string;
  clientInstanceId: string;
  selections?: SideChatSelection[];
  config?: Partial<SideChatConfig>;
}
