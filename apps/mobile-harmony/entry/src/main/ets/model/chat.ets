import type { XopcTurnClaim } from './realtime';

export interface XopcSessionItem {
  key: string; name?: string; title?: string; displayName?: string; messageCount: number;
  updatedAt: string; status?: string; projectId?: string; agentId?: string;
}
export interface XopcSessionList { items: XopcSessionItem[]; total: number; hasMore: boolean; }
export interface XopcContentBlock { type: string; text?: string; thinking?: string; name?: string; }
export interface XopcHistoryMedia { id: string; name: string; type: string; mimeType: string; size: number; uri: string; }
export interface XopcMessage { id?: string; role: string; content: string | XopcContentBlock[]; media?: XopcHistoryMedia[]; }
export interface XopcSessionDetail { key: string; transcriptId?: string; name?: string; status?: string; messages: XopcMessage[]; }
export interface XopcHistoryPagination { hasMore: boolean; nextBeforeCursor?: string; }
export interface XopcHistory { session: XopcSessionDetail; pagination: XopcHistoryPagination; }
export interface XopcCreatedSession { session: XopcSessionDetail; }
export interface XopcCreateSession { channel: string; projectId?: string; agentId?: string; }
export interface XopcInput {
  clientMessageId: string; expectedTranscriptId?: string; delivery: string; content: string; origin: XopcTurnClaim;
  attachments?: XopcChatAttachment[];
}
export interface XopcChatAttachment { type: string; name: string; mimeType: string; size: number; data: string; }
export interface XopcInputState { activeRunId?: string; }
export interface XopcInputResult { state: XopcInputState; }
export interface XopcRun { active: boolean; runId?: string; }
export interface XopcAbort { runId: string; }
export interface XopcRename { name: string; }
export interface XopcStreamPayload { delta?: string; messageId?: string; message?: string; toolName?: string; status?: string; }
export interface XopcStreamEvent { type: string; runId: string; conversationId: string; payload: XopcStreamPayload; }
export interface XopcChatRow { id: string; role: string; text: string; }
