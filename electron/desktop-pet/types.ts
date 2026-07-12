export type DesktopPetAction =
  | 'idle'
  | 'typing'
  | 'toolbox'
  | 'search'
  | 'file'
  | 'terminal'
  | 'browser'
  | 'success'
  | 'error';

export type DesktopPetFeedbackLevel = 'quiet' | 'normal' | 'chatty';

export type DesktopPetBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopPetDragPoint = {
  screenX: number;
  screenY: number;
};

export type DesktopPetAnimation = {
  imageDataUrl: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  offsetX: number;
  offsetY: number;
  sheetWidth?: number;
  sheetHeight?: number;
};

export type DesktopPetDefinition = {
  id: string;
  name: string;
  description: string;
  sourcePrompt?: string;
  builtin: boolean;
  canvasWidth: number;
  canvasHeight: number;
  thumbnailDataUrl: string;
  animations: Record<DesktopPetAction, DesktopPetAnimation>;
};

export type DesktopPetIssue = {
  dir: string;
  reason: string;
  details?: string[];
};

export type DesktopPetCreateRequest = {
  name?: string;
  prompt: string;
  description?: string;
  overwrite?: boolean;
};

export type DesktopPetCreateResult = {
  id: string;
  name: string;
  dir: string;
  manifestPath: string;
  sourcePrompt?: string;
};

export type DesktopPetPrefs = {
  enabled: boolean;
  showOnStartup: boolean;
  selectedPetId: string;
  alwaysOnTop: boolean;
  bubbleEnabled: boolean;
  clickThroughWhenIdle: boolean;
  muted: boolean;
  feedbackLevel: DesktopPetFeedbackLevel;
  sizePercent: number;
  collapsed: boolean;
  bounds?: DesktopPetBounds;
};

export type DesktopPetState = {
  prefs: DesktopPetPrefs;
  pets: DesktopPetDefinition[];
  visible: boolean;
  customPetsDir: string;
  petIssues: DesktopPetIssue[];
};

export type DesktopPetEventKind =
  | 'hello'
  | 'info'
  | 'agent-start'
  | 'agent-tool'
  | 'agent-progress'
  | 'agent-success'
  | 'agent-error'
  | 'goal'
  | 'toast';

export type DesktopPetEvent = {
  id?: string;
  kind: DesktopPetEventKind;
  message?: string;
  title?: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  sessionKey?: string;
  route?: string;
  toolName?: string;
  createdAt?: number;
};
