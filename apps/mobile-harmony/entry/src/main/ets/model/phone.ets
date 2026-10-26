export interface XopcPhoneBinding {
  conversationId: string;
  transcriptId: string;
  phoneSessionId: string;
  phoneDeviceId: string;
}
export interface XopcPhoneAssistanceReference { id: string; version: number; }
export interface XopcPhoneSummary {
  available: boolean;
  access: string;
  needsUser: boolean;
  assistance?: XopcPhoneAssistanceReference;
  binding?: XopcPhoneBinding;
  deviceName?: string;
  taskState?: string;
}
export interface XopcPhoneReport {
  sessionId: string;
  deviceId?: string;
  deviceName: string;
  status: string;
  mode: string;
  controlOwner?: string;
  controlEpoch: number;
  handoff?: string;
  assistanceId?: string;
  assistanceVersion?: number;
  hasPendingTask?: boolean;
  revision?: number;
  reconnectRequired?: boolean;
  stopReason?: string;
  message?: string;
  currentAction?: string;
}
export interface XopcPhoneLiveState {
  report: XopcPhoneReport;
  ownControl: boolean;
  textInput?: string;
}
export interface XopcPhoneEnvelope<T> { ok: boolean; payload: T; }
export interface XopcPhoneCompatibility { mobilePhoneWorkspaceV1?: boolean; }
export interface XopcPhoneTicket { ticket: string; path: string; }
export interface XopcPhoneAction {
  type: string;
  point?: number[];
  start?: number[];
  end?: number[];
  durationMs?: number;
  text?: string;
}
export interface XopcPhoneControlRequest {
  clientId: string;
  assistanceId?: string;
  assistanceVersion?: number;
  operationId: string;
  epoch: number;
  expectedTranscriptId: string;
  op: string;
  action?: XopcPhoneAction;
  frameSeq?: number;
  geometry?: number;
}
export interface XopcPhoneVideoGeometry { type: string; width: number; height: number; version: number; codec: string; }
export interface XopcPhoneVideoMessage { type: string; code?: string; seq?: number; }
export interface XopcPhoneFrame { bytes: ArrayBuffer; seq: number; width: number; height: number; capturedAt: number; }
export interface XopcPhoneFailureBody { error?: XopcPhoneFailureDetail; }
export interface XopcPhoneFailureDetail { code?: string; }
export interface XopcPhoneTicketRequest { clientId: string; purpose: string; expectedTranscriptId: string; epoch?: number; }
export interface XopcPhoneFrameHeaders { 'X-Phone-Frame-Seq'?: string; 'X-Phone-Width'?: string; 'X-Phone-Height'?: string; 'X-Phone-Captured-At'?: string; }
