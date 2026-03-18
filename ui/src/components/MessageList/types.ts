export interface Attachment {
  id?: string;
  name?: string;
  type?: string;
  mimeType?: string;
  size?: number;
  content?: string;
  data?: string;
}

export interface MessageContent {
  type: string;
  text?: string;
  source?: { data?: string };
  name?: string;
  input?: unknown;
  function?: { name?: string; arguments?: unknown };
  content?: unknown;
  is_error?: boolean;
  error?: boolean;
  /** Thinking/reasoning content from the model */
  thinking?: string;
}

export interface Message {
  role: string;
  content: MessageContent[];
  attachments?: Attachment[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cost?: number;
  };
  timestamp?: number;
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  /** Thinking content for the message (separate from content array) */
  thinking?: string;
  /** Whether thinking is still streaming */
  thinkingStreaming?: boolean;
}
