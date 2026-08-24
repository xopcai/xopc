import type { Message } from '@/features/chat/messages/messages.types';

export type SideChatSelection = {
  id: string;
  type: 'text';
  text: string;
  label?: string;
};

export type SideChatView = {
  id: string;
  parentSessionKey: string;
  clientInstanceId: string;
  status: 'idle' | 'running' | 'waiting-approval' | 'waiting-input' | 'closing';
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  messageCount: number;
  context: {
    parentSessionKey: string;
    parentSessionId: string;
    parentMessageCount: number;
    createdAt: string;
    selections: SideChatSelection[];
    contentHash: string;
  };
  config: { modelRef: string; thinkingLevel?: string };
};

export type SideChatTab = {
  id: string;
  parentSessionKey: string;
  title: string;
  runId?: string;
};

export type SideChatConversation = {
  messages: Message[];
  streaming: boolean;
  runId?: string;
  error?: string;
};
