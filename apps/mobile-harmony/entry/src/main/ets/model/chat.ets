import type { XopcTurnClaim } from './realtime';

export interface XopcSessionItem {
  key: string; name?: string; title?: string; displayName?: string; messageCount: number;
  updatedAt: string; status?: string; projectId?: string; agentId?: string;
}
export interface XopcSessionList { items: XopcSessionItem[]; total: number; hasMore: boolean; }
export interface XopcContentBlock { type: string; text?: string; thinking?: string; name?: string; id?: string; input?: Object; args?: Object; arguments?: Object; }
export interface XopcHistoryMedia { id: string; name: string; type: string; mimeType: string; size: number; uri: string; }
export interface XopcHistorySource { kind: string; sourceId: string; version: string; title?: string; }
export interface XopcMessageMetadata { sourceContexts?: XopcHistorySource[]; }
export interface XopcHistoryToolCall { id?: string; name?: string; args?: Object; result?: Object; isError?: boolean; }
export interface XopcOpenAiToolCall { id: string; function: XopcToolFunction; }
export interface XopcToolFunction { name: string; arguments?: string; }
export interface XopcMessage { id?: string; messageId?: string; role: string; content: string | XopcContentBlock[];
  rawContent?: XopcContentBlock[]; media?: XopcHistoryMedia[]; metadata?: XopcMessageMetadata;
  toolCalls?: XopcHistoryToolCall[]; tool_calls?: XopcOpenAiToolCall[];
  toolCallId?: string; tool_call_id?: string; isError?: boolean;
}
export interface XopcSessionDetail { key: string; transcriptId?: string; name?: string; status?: string; agentId?: string; projectId?: string; messages: XopcMessage[]; }
export interface XopcHistoryPagination { hasMore: boolean; nextBeforeCursor?: string; }
export interface XopcHistory { session: XopcSessionDetail; pagination: XopcHistoryPagination; }
export interface XopcCreatedSession { session: XopcSessionDetail; }
export interface XopcCreateSession { channel: string; projectId?: string | null; agentId?: string; executionMode?: string; initialAgentConfig?: XopcAgentConfig; }
export interface XopcInput {
  clientMessageId: string; expectedTranscriptId?: string; delivery: string; content: string; origin: XopcTurnClaim;
  attachments?: XopcChatAttachment[];
  contextRefs?: XopcContextRef[];
}
export interface XopcChatAttachment { type: string; name: string; mimeType: string; size: number; data: string; workspaceRelativePath?: string; uri?: string; }
export interface XopcInputState { activeRunId?: string; }
export interface XopcInputResult { state: XopcInputState; }
export interface XopcRun { active: boolean; runId?: string; }
export interface XopcAbort { runId: string; }
export interface XopcRename { name: string; }
export interface XopcStreamPayload { delta?: string; messageId?: string; message?: string; toolName?: string; status?: string; }
export interface XopcStreamEvent { type: string; runId: string; conversationId: string; payload: XopcStreamPayload; }
export interface XopcChatTool { id: string; name: string; input?: Object; result?: string; isError?: boolean; }
export interface XopcChatRow { id: string; role: string; text: string; thinking?: string; tools?: string; media?: XopcHistoryMedia[]; refs?: XopcContextRef[];
  toolCalls?: XopcChatTool[]; toolResultId?: string; toolResultError?: boolean;
}
export interface XopcDrawerProfile { profile?: XopcProfileFields; suggestedCallName?: string; }
export interface XopcProfileFields { callName?: string; role?: string; }
export interface XopcSessionGroup { id: string; label: string; items: XopcSessionItem[]; }
export interface XopcChatModel { id: string; name?: string; description?: string; displayNames?: Record<string, string>; }
export interface XopcChatModels { defaultId?: string; models?: XopcChatModel[]; items?: XopcChatModel[]; }
export interface XopcAgentSkillConfig { mode?: string; include?: string[]; }
export interface XopcAgentEffective { skills?: XopcAgentSkillConfig; }
export interface XopcChatAgent { id: string; name?: string; description?: string; effective?: XopcAgentEffective; }
export interface XopcChatAgents { defaultId: string; agents: XopcChatAgent[]; }
export interface XopcAgentConfig { model?: string; thinkingLevel?: string; reasoningLevel?: string; effectiveWorkspacePath?: string; workingDirectoryLocked?: boolean; }
export interface XopcQueuedInput {
  id: string; clientMessageId: string; content: string; version: number; position: number;
  kind: string; status: string; effectiveDelivery: string;
}
export interface XopcQueueState { conversationId: string; activeRunId?: string; inputs: XopcQueuedInput[]; }
export interface XopcQueueUpdate { version: number; content: string; }
export interface XopcContextRef { kind: string; sourceId: string; expectedVersion: string; title?: string; }
export interface XopcContextWorkItem { id: string; title: string; phase?: string; }
export interface XopcContextWork { project?: XopcContextWorkItem; task?: XopcContextWorkItem; }
export interface XopcContextSource { id: string; title?: string; unavailable?: boolean; }
export interface XopcChatEnvironment { kind: string; rootPath: string; available: boolean; branch?: string; headSha?: string; }
export interface XopcContextSummary { conversationId: string; work: XopcContextWork; sources: XopcContextSource[]; sourcesHasMore: boolean; environment?: XopcChatEnvironment; unavailableSections: string[]; }
export interface XopcContextResult { summary: XopcContextSummary; }
export interface XopcEnvironmentOptions { localAvailable: boolean; worktreeUnavailableReason?: string; }
export interface XopcEnvironmentResult { options: XopcEnvironmentOptions; }
export interface XopcHostDirectory { name: string; absolutePath: string; isDirectory: boolean; }
export interface XopcHostDirectories { currentPath: string; parentPath?: string; entries: XopcHostDirectory[]; }
export interface XopcWorkingDirectory { workingDirectory: string; }
export interface XopcReferenceItem { kind: string; id: string; title: string; description: string; version: string; relativePath?: string; directory?: boolean; mimeType?: string; size?: number; }
