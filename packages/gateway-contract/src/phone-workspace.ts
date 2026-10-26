/** Safe discovery metadata; pixels and UI facts never enter the chat cache. */
export interface ConversationPhoneSummary {
  available: boolean;
  access: 'none' | 'view' | 'control';
  needsUser: boolean;
  assistance?: { id: string; version: number };
  binding?: { conversationId: string; transcriptId: string; phoneSessionId: string; phoneDeviceId: string };
  deviceName?: string;
  taskState?: string;
  updatedAt?: number;
}
