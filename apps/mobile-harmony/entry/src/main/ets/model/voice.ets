import { XopcClarification, XopcClarificationChoice, XopcClarificationApproval } from './clarification';
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
  openingGreeting?: boolean;
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

export interface XopcVoiceOpeningGreetingRequest {
  logicalCallId: string;
  initiation: string;
  supportsOutputReady: boolean;
}
export interface XopcVoiceOpeningGreeting {
  accepted: boolean;
  greetingResponseId?: string;
}
export interface XopcVoiceSession {
  openingGreeting?: XopcVoiceOpeningGreeting;
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
  openingGreeting?: XopcVoiceOpeningGreetingRequest;
  purpose: string;
  conversationId?: string;
  mode?: string;
  language?: string;
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
  utteranceId?: string;
  revision?: number;
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
  choiceDetails?: XopcClarificationChoice[];
  interactionMode?: string;
  recommendedChoiceId?: string;
  approval?: XopcClarificationApproval;
  version?: number;
  createdAt?: number;
  expiresAt?: number;
}

export interface XopcVoiceClarification extends XopcClarification {}

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
  connectionEpoch?: number;
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
