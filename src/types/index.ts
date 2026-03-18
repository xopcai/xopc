export interface InboundMessage {
  channel: string;
  sender_id: string;
  chat_id: string;
  content: string;
  media?: Array<{ type: string; fileId: string }>;
  attachments?: Array<{
    type: string;
    mimeType: string;
    data: string;
    name?: string;
    size?: number;
  }>;
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  channel: string;
  chat_id: string;
  content?: string;
  type?: 'message' | 'typing_on' | 'typing_off';
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'audio' | 'document' | 'animation';
  metadata?: Record<string, unknown>;
  /**
   * Send audio as voice message (bubble) instead of audio file.
   * This is set by the TTS system when generating voice messages.
   */
  audioAsVoice?: boolean;
  // Reply support
  replyToMessageId?: string;
  quoteText?: string;
  // Message options
  silent?: boolean;
  spoiler?: boolean;
  // Telegram inline keyboard buttons
  buttons?: Array<Array<{
    text: string;
    callback_data: string;
  }>>;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'toolResult';
  content: string;
  timestamp?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id$?: string; // pi-ai format
  toolName?: string; // pi-ai format
  isError?: boolean; // pi-ai format
  name?: string;
}

export interface SessionInfo {
  key: string;
  created_at: string;
  updated_at: string;
  path: string;
}

export interface Config {
  agents?: {
    defaults?: {
      workspace?: string;
      model?: string;
      maxTokens?: number;
      temperature?: number;
      max_tool_iterations?: number;
    };
  };
  channels?: {
    telegram?: {
      enabled?: boolean;
      token?: string;
      allowFrom?: string[];
    };
  };
  providers?: Record<string, { apiKey?: string; apiBase?: string }>;
  gateway?: {
    host?: string;
    port?: number;
  };
  tools?: {
    web?: {
      search?: {
        apiKey?: string;
        maxResults?: number;
      };
    };
  };
  //  Extension config
  // Supports both global config (security, slots) and per-extension config
  // e.g., config.extensions.security = {...}
  // e.g., config.extensions.enabled = ["hello", "echo"]
  // e.g., config.extensions.hello = { greeting: "Hi there!" }
  extensions?: {
    enabled?: string[];
    allow?: string[];
    security?: {
      checkPermissions?: boolean;
      allowUntrusted?: boolean;
      trackProvenance?: boolean;
      allowPromptInjection?: boolean;
    };
    slots?: {
      memory?: string;
      tts?: string;
      imageGeneration?: string;
      webSearch?: string;
    };
    // Allow arbitrary extension-specific configuration
    // Each extension can access its config via api.extensionConfig
    [key: string]: unknown;
  };
}

export {
  SessionStatus,
  type SessionMetadata,
  type SessionDetail,
  type SessionListQuery,
  type PaginatedResult,
  type SessionStats,
  type ExportFormat,
  type SessionExport,
} from '../session/types.js';

// Re-export provider types
export * from './providers.js';
