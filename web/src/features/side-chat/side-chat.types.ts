import type { Message } from '@/features/chat/messages/messages.types';

export type SideChatSelection = {
  id: string;
  type: 'text';
  text: string;
  label?: string;
};

export type SideChatView = {
  id: string;
  parentConversationId: string;
  clientInstanceId: string;
  status: 'idle' | 'running' | 'waiting-approval' | 'waiting-input' | 'closing';
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string | null;
  serverNow?: string;
  runId?: string;
  clarification?: {
    requestId: string;
    kind: 'input' | 'approval';
    question: string;
    choices?: string[];
    suggestedAnswer?: string;
  };
  messageCount: number;
  context: {
    parentConversationId: string;
    parentSessionId: string;
    parentMessageCount: number;
    createdAt: string;
    selections: SideChatSelection[];
    contentHash: string;
  };
  config: { modelRef: string; thinkingLevel: string };
};

export type SideChatTab = {
  id: string;
  parentConversationId: string;
  title: string;
  runId?: string;
  ended?: 'idle' | 'waiting' | 'unavailable';
  fresh?: boolean;
};

export type SideChatConversation = {
  messages: Message[];
  streaming: boolean;
  runId?: string;
  error?: string;
};
