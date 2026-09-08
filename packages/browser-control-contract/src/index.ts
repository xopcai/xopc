export type BrowserVisualMode = 'never' | 'auto' | 'always';
export type BrowserRiskLevel = 'read' | 'draft' | 'external_effect' | 'destructive' | 'sensitive';

export const BROWSER_EXTENSION_PROTOCOL_VERSION = 3;

export interface BrowserExpectation {
  urlIncludes?: string;
  titleIncludes?: string;
  textIncludes?: string;
  ref?: string;
  state?: 'visible' | 'hidden';
}

export interface BrowserInputBase {
  sessionId?: string;
  approvalId?: string;
}

export interface BrowserObserveInput extends BrowserInputBase {
  action: 'observe';
  visual?: BrowserVisualMode;
}

export interface BrowserNavigateInput extends BrowserInputBase {
  action: 'navigate';
  url: string;
  expect?: BrowserExpectation;
}

export interface BrowserRefInput extends BrowserInputBase {
  revision: number;
  ref: string;
  expect?: BrowserExpectation;
}

export interface BrowserClickInput extends BrowserRefInput {
  action: 'click';
}

export interface BrowserFillInput extends BrowserRefInput {
  action: 'fill';
  value: string;
  submit?: boolean;
}

export interface BrowserSelectInput extends BrowserRefInput {
  action: 'select';
  value: string;
}

export interface BrowserPressInput extends BrowserInputBase {
  action: 'press';
  revision: number;
  ref?: string;
  key: string;
  expect?: BrowserExpectation;
}

export interface BrowserScrollInput extends BrowserInputBase {
  action: 'scroll';
  revision: number;
  ref?: string;
  deltaY: number;
  expect?: BrowserExpectation;
}

export interface BrowserWaitInput extends BrowserInputBase {
  action: 'wait';
  revision: number;
  condition: 'page_idle' | 'text' | 'visible' | 'hidden';
  value?: string;
  ref?: string;
  timeoutMs?: number;
}

export interface BrowserUploadInput extends BrowserRefInput {
  action: 'upload';
  paths: string[];
}

export interface BrowserTabsInput extends BrowserInputBase {
  action: 'tabs';
  operation: 'list' | 'create' | 'activate' | 'close';
  tabId?: string;
  url?: string;
}

export type BrowserSequenceStep =
  | Omit<BrowserClickInput, 'sessionId' | 'revision' | 'approvalId'>
  | Omit<BrowserFillInput, 'sessionId' | 'revision' | 'approvalId'>
  | Omit<BrowserSelectInput, 'sessionId' | 'revision' | 'approvalId'>
  | Omit<BrowserPressInput, 'sessionId' | 'revision' | 'approvalId'>
  | Omit<BrowserScrollInput, 'sessionId' | 'revision' | 'approvalId'>;

export interface BrowserSequenceInput extends BrowserInputBase {
  action: 'sequence';
  revision: number;
  steps: BrowserSequenceStep[];
  expect?: BrowserExpectation;
}

export interface BrowserCloseInput extends BrowserInputBase {
  action: 'close';
}

export type BrowserActionInput =
  | BrowserObserveInput
  | BrowserNavigateInput
  | BrowserClickInput
  | BrowserFillInput
  | BrowserSelectInput
  | BrowserPressInput
  | BrowserScrollInput
  | BrowserWaitInput
  | BrowserUploadInput
  | BrowserTabsInput
  | BrowserSequenceInput
  | BrowserCloseInput;

export interface BrowserNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  states: string[];
  parent?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface BrowserObservationChanges {
  added: BrowserNode[];
  changed: BrowserNode[];
  removed: string[];
}

export interface BrowserVisual {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: string;
  width?: number;
  height?: number;
}

export interface BrowserObservation {
  sessionId: string;
  tabId: string;
  revision: number;
  documentId: string;
  url: string;
  title: string;
  focused?: string;
  nodes: BrowserNode[];
  changes: BrowserObservationChanges;
  visual?: BrowserVisual;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface BrowserActionReceipt {
  action: BrowserActionInput['action'];
  risk: BrowserRiskLevel;
  durationMs: number;
  verified: boolean;
  observation?: BrowserObservation;
  tabs?: BrowserTab[];
}

export interface BrowserControlError {
  code:
    | 'ABORTED'
    | 'APPROVAL_REQUIRED'
    | 'BLOCKED_URL'
    | 'DRIVER_UNAVAILABLE'
    | 'EXPECTATION_FAILED'
    | 'INVALID_INPUT'
    | 'SESSION_NOT_FOUND'
    | 'STALE_OBSERVATION'
    | 'TARGET_NOT_FOUND'
    | 'TIMEOUT'
    | 'UNSUPPORTED_PAGE';
  message: string;
  observation?: BrowserObservation;
  approval?: {
    id: string;
    risk: BrowserRiskLevel;
    summary: string;
    expiresAt: string;
  };
}

export type BrowserControlResult =
  | { ok: true; receipt: BrowserActionReceipt }
  | { ok: false; error: BrowserControlError };

export interface BrowserWireCommand {
  id: string;
  protocolVersion: typeof BROWSER_EXTENSION_PROTOCOL_VERSION;
  input: BrowserActionInput;
  timeoutMs: number;
  visualFallback: boolean;
}

export interface BrowserWireResult {
  id: string;
  result: BrowserControlResult;
}

export interface BrowserWireKeepAlive {
  type: 'keepalive';
  timestamp: number;
}

export interface BrowserExtensionStatus {
  type: 'status';
  protocolVersion: typeof BROWSER_EXTENSION_PROTOCOL_VERSION;
  extensionVersion: string;
  connected: boolean;
  sessionCount: number;
}
