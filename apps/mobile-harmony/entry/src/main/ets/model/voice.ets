export interface XopcVoiceAvailability {
  available: boolean;
  reasonCode?: string;
}

export interface XopcVoiceCapabilities {
  dictation: XopcVoiceAvailability;
  assistant: XopcVoiceAvailability;
  natural: XopcVoiceAvailability;
  languages: string[];
  bargeIn: boolean;
  mediaTransports: string[];
}

export interface XopcVoiceStatus {
  enabled: boolean;
  defaultMode: string;
  capabilities: XopcVoiceCapabilities;
}

export interface XopcVoiceFormat {
  encoding: string;
  sampleRate: number;
  channels: number;
}

export interface XopcVoiceMedia {
  transport: string;
  codec: string;
  frameDurationMs: number;
}

export interface XopcVoiceLimits {
  maxBinaryFrameBytes: number;
  maxSessionMs: number;
  idleTimeoutMs: number;
}

export interface XopcVoiceRoute {
  engine: string;
}

export interface XopcVoiceSession {
  sessionId: string;
  ticket: string;
  ticketExpiresAt: string;
  websocketPath: string;
  protocolVersion: number;
  connectionEpoch: number;
  purpose: string;
  mode?: string;
  inputMode: string;
  bargeIn: boolean;
  inputFormat: XopcVoiceFormat;
  media: XopcVoiceMedia;
  limits: XopcVoiceLimits;
  route: XopcVoiceRoute;
}

export interface XopcVoiceSessionRequest {
  purpose: string;
  conversationId: string;
  mode: string;
  supportedProtocolVersions: number[];
  mediaPreferences: string[];
}

export interface XopcVoicePayload<T> {
  payload: T;
}

export interface XopcVoiceErrorBody {
  code?: string;
}

export interface XopcVoiceErrorEnvelope {
  error?: XopcVoiceErrorBody;
}

export interface XopcVoiceEventPayload {
  connectionEpoch?: number;
  heartbeatIntervalMs?: number;
  route?: XopcVoiceRoute;
  responseId?: string;
  taskId?: string;
  toolCallId?: string;
  toolName?: string;
  status?: string;
  text?: string;
  delta?: string;
  audio?: boolean;
  finishReason?: string;
  reason?: string;
  code?: string;
  message?: string;
  recoverable?: boolean;
  format?: XopcVoiceFormat;
  requestId?: string;
  kind?: string;
  question?: string;
  choices?: string[];
  suggestedAnswer?: string;
  version?: number;
  createdAt?: number;
  expiresAt?: number;
}

export interface XopcVoiceClarification {
  requestId: string;
  question: string;
  choices: string[];
  suggestedAnswer: string;
  version: number;
  kind: string;
}

export interface XopcVoiceApproval {
  id: string;
  conversationId: string;
  actionId: string;
  status: string;
  expiresAt: string;
}

export interface XopcVoiceApprovalsPayload {
  approvals: XopcVoiceApproval[];
}

export interface XopcVoiceClientPayload {
  sessionId?: string;
  ticket?: string;
  muted?: boolean;
  responseId?: string;
  playedDurationMs?: number;
  taskId?: string;
  reason?: string;
  metric?: string;
  durationMs?: number;
}

export interface XopcVoiceServerEvent {
  protocolVersion: number;
  eventId: string;
  seq: number;
  type: string;
  sentAt: number;
  sessionId: string;
  payload: XopcVoiceEventPayload;
}

export interface XopcVoiceAudioFrame {
  connectionEpoch: number;
  responseId: string;
  seq: number;
  mediaTimestampMs: number;
  durationMs: number;
  audio: Uint8Array;
}

export interface XopcVoiceUplinkFrame {
  connectionEpoch: number;
  utteranceId: string;
  audioSeq: number;
  capturedAtMonotonicMs: number;
  start: boolean;
  end: boolean;
  audio: Uint8Array;
}

export interface XopcVoiceCallTarget {
  conversationId: string;
  mode: string;
  background: boolean;
  name: string;
}
