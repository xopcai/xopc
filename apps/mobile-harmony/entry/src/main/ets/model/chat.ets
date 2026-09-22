import type { XopcTurnClaim } from './realtime';

export interface XopcSessionItem {
  key: string; name?: string; title?: string; displayName?: string; messageCount: number;
  updatedAt: string; status?: string; projectId?: string; agentId?: string;
}
export interface XopcSessionList { items: XopcSessionItem[]; total: number; hasMore: boolean; }
export interface XopcContentBlock { type: string; text?: string; thinking?: string; name?: string; id?: string; input?: Object; args?: Object; arguments?: Object;
  segmentId?: string; presentation?: string; status?: string; result?: Object; details?: Object;
  source?: XopcImageSource; data?: string; mimeType?: string; uri?: string; workspaceRelativePath?: string;
  target?: string; summary?: string; findings?: XopcReviewFinding[]; overallCorrectness?: string; overallExplanation?: string;
}
export interface XopcImageSource { data?: string; media_type?: string; }
export interface XopcAudioWire { uri?: string; url?: string; audioUri?: string; audio_url?: string;
  workspaceRelativePath?: string; workspace_relative_path?: string; path?: string;
  data?: string; mimeType?: string; mime_type?: string; name?: string;
}
export type XopcAudioCandidate = string | XopcAudioWire;
export interface XopcReviewFinding { title: string; body: string; priority: number; filePath?: string; lineStart?: number; lineEnd?: number; }
export interface XopcChatBlock { id: string; kind: string; text: string; segmentId?: string; presentation?: string; active?: boolean;
  call?: XopcChatTool; file?: XopcHistoryMedia; review?: XopcContentBlock; plan?: XopcPlanStep[];
}
export interface XopcPlanStep { step: string; status: string; }
export interface XopcArtifact { artifactId: string; sourceFileId?: string; title: string; kind: string; mimeType?: string; sizeBytes?: number;
  availability: string; location?: string; capabilities?: string[]; uri?: string; workspaceRelativePath?: string; shareUrl?: string;
}
export interface XopcTurnOutcome { version: number; outcomeId: string; runId: string; turnId: string; status: string; summary?: string; deliverables: XopcArtifact[]; }
export interface XopcProductReference { kind: string; id: string; title: string; summary?: string; status?: string; capabilities?: string[]; }
export interface XopcProductPresentation { kind: string; items?: XopcProductReference[]; truncated?: boolean; }
export interface XopcProductDelivery { version: number; operation: string; primary?: XopcProductReference; related?: XopcProductReference[]; presentation?: XopcProductPresentation; }
export interface XopcHistoryMedia { id: string; name: string; type: string; mimeType: string; size: number; uri: string; fileId?: string; workspaceRelativePath?: string; data?: string; extractedText?: string; }
export interface XopcHistorySource { kind: string; sourceId: string; version: string; title?: string; }
export interface XopcMessageMetadata { sourceContexts?: XopcHistorySource[]; turnOutcome?: XopcTurnOutcome; review?: XopcContentBlock; }
export interface XopcHistoryToolCall { id?: string; name?: string; args?: Object; result?: Object; isError?: boolean; details?: Object; }
export interface XopcOpenAiToolCall { id: string; function: XopcToolFunction; }
export interface XopcToolFunction { name: string; arguments?: string; }
export interface XopcMessage { id?: string; messageId?: string; role: string; content: string | XopcContentBlock[];
  rawContent?: XopcContentBlock[]; media?: XopcHistoryMedia[]; attachments?: XopcHistoryMedia[]; metadata?: XopcMessageMetadata;
  toolCalls?: XopcHistoryToolCall[]; tool_calls?: XopcOpenAiToolCall[];
  toolCallId?: string; tool_call_id?: string; isError?: boolean; details?: Object; turnId?: string;
  ttsAudio?: XopcAudioCandidate | XopcAudioCandidate[]; tts_audio?: XopcAudioCandidate | XopcAudioCandidate[];
  tts?: XopcAudioCandidate | XopcAudioCandidate[]; audio?: XopcAudioCandidate | XopcAudioCandidate[];
  ttsAudioUri?: string; tts_audio_uri?: string; audioUri?: string; audio_url?: string;
  mimeType?: string; mime_type?: string; name?: string;
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
export interface XopcStreamPayload { delta?: string; messageId?: string; message?: string; toolName?: string; status?: string;
  toolCallId?: string; args?: Object; result?: Object; details?: Object; textDelta?: string; presentation?: string;
  command?: string; cwd?: string; exitCode?: number; timedOut?: boolean; diff?: string; review?: XopcContentBlock;
  plan?: XopcPlanStep[]; explanation?: string; uri?: string; mimeType?: string; name?: string;
}
export interface XopcStreamEvent { type: string; runId: string; conversationId: string; payload: XopcStreamPayload; }
export interface XopcChatTool { id: string; name: string; input?: Object; result?: string; isError?: boolean; status?: string; details?: Object; }
export interface XopcChatRow { id: string; role: string; text: string; thinking?: string; tools?: string; media?: XopcHistoryMedia[]; refs?: XopcContextRef[];
  toolCalls?: XopcChatTool[]; toolResultId?: string; toolResultError?: boolean; toolResultDetails?: Object;
  blocks?: XopcChatBlock[]; outcome?: XopcTurnOutcome; turnId?: string; live?: boolean; progress?: string; sourceIds?: string[];
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
