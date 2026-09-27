import { XopcContextRef, XopcInputState, XopcSessionDetail, XopcAgentConfig } from './chat';
import { XopcTurnClaim } from './realtime';

export interface XopcSessionExecution { mode: string; baseRef?: string; }
export interface XopcSessionCreation {
  agentId: string; projectId: string | null; execution: XopcSessionExecution | null;
  temporary: boolean; model: string; thinkingLevel: string;
}
export interface XopcInputAttachment { type: string; name: string; mimeType: string; size: number; data: string; workspaceRelativePath?: string; uri?: string; durationSeconds?: number; }
export interface XopcSessionInputContent { content: string; attachments?: XopcInputAttachment[]; contextRefs?: XopcContextRef[]; }
export interface XopcMaterialization { commandId: string; purpose: string; }
export interface XopcMaterializeCommand { commandId: string; purpose: string; creation: XopcSessionCreation; }
export interface XopcSessionCommand {
  kind: string; clientMessageId: string; creation?: XopcSessionCreation;
  expectedTranscriptId?: string; configVersion?: number; delivery?: string;
  input: XopcSessionInputContent; origin?: XopcTurnClaim;
}
export interface XopcLocalSession {
  conversationId: string; creation: XopcSessionCreation; createdAt: string;
  command?: XopcSessionCommand;
  materialization?: XopcMaterialization;
}
export interface XopcSessionReceipt { conversationId: string; clientMessageId: string; transcriptId: string; lifecycle: string; }
export interface XopcSessionCommandResult {
  receipt: XopcSessionReceipt; session: XopcSessionDetail; agentConfig: XopcAgentConfig; inputState: XopcInputState;
}
