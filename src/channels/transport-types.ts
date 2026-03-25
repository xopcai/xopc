/** Inbound message DTO for channel → agent pipelines. */
export interface InboundMessage {
  channel: string;
  sender_id: string;
  chat_id: string;
  content: string;
  media?: Array<{ type: string; fileId: string }>;
  attachments?: Array<{
    type: string;
    mimeType?: string;
    data?: string;
    name?: string;
    size?: number;
    /** Relative to configured workspace (`agents.defaults.workspace`), POSIX `/`. */
    workspaceRelativePath?: string;
  }>;
  metadata?: Record<string, unknown>;
}

/** Outbound message DTO for agent → channel delivery. */
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
  replyToMessageId?: string;
  quoteText?: string;
  silent?: boolean;
  spoiler?: boolean;
  buttons?: Array<Array<{
    text: string;
    callback_data: string;
  }>>;
}
