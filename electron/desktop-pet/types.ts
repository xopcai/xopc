export type DesktopPetAction =
  | "idle"
  | "sleep"
  | "wake"
  | "greet"
  | "prepare"
  | "research"
  | "read"
  | "create"
  | "execute"
  | "wait"
  | "success"
  | "concern"
  | "pet"
  | "pickedUp"
  | "released";

export type DesktopPetBehaviorMode = "focus" | "companion" | "playful";

export type DesktopPetActivityPhase =
  | "preparing"
  | "planning"
  | "researching"
  | "reading"
  | "editing"
  | "running"
  | "browsing"
  | "compacting"
  | "waiting";

export type DesktopPetActivity = {
  phase?: DesktopPetActivityPhase;
  /** A short, safe-to-display target such as a file basename or origin. */
  detail?: string;
  completed?: number;
  total?: number;
};

export type DesktopPetAnchor = {
  x: number;
  y: number;
};

export type DesktopPetContentSize = {
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

export type DesktopPetPersonaTone = "calm" | "warm" | "playful" | "focused";

export type DesktopPetPersonaPhrases = {
  greeting?: string[];
  success?: string[];
  waiting?: string[];
  error?: string[];
};

export type DesktopPetPersona = {
  tone: DesktopPetPersonaTone;
  warmth: number;
  energy: number;
  humor: number;
  phrases?: DesktopPetPersonaPhrases;
};

export type DesktopPetDefinition = {
  id: string;
  name: string;
  description: string;
  i18nKey?: string;
  sourcePrompt?: string;
  builtin: boolean;
  canvasWidth: number;
  canvasHeight: number;
  thumbnailDataUrl: string;
  animations: Record<DesktopPetAction, DesktopPetAnimation>;
  persona?: DesktopPetPersona;
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
  behaviorMode: DesktopPetBehaviorMode;
  proactiveTipsEnabled: boolean;
  interactionEnabled: boolean;
  reducedMotion: boolean;
  remindersPausedUntil?: number;
  sizePercent: number;
  collapsed: boolean;
  anchor?: DesktopPetAnchor;
};

export type DesktopPetState = {
  prefs: DesktopPetPrefs;
  relationship: DesktopPetRelationship;
  relationshipMoment?: DesktopPetRelationshipMoment;
  pets: DesktopPetDefinition[];
  visible: boolean;
  customPetsDir: string;
  petIssues: DesktopPetIssue[];
  activities: PetSessionUpdate[];
};

export type DesktopPetRelationshipMoment = "first_meeting" | "new_day" | "returning";

export type DesktopPetRelationship = {
  firstMetAt: number;
  lastSeenAt: number;
  completedTaskCount: number;
  unlockedReactions: string[];
  recentCompletedRunIds: string[];
};

export type PetSessionState = "running" | "waiting" | "success" | "error";

export type PetFeedback = {
  version: 2;
  taskState: "working" | "waiting" | "success" | "error";
  publicSummary?: string;
  reassurance?: "making_progress" | "waiting_safely" | "completed" | "work_preserved" | "details_available";
  nextAction?: {
    type: "open_session" | "confirm" | "review_error";
    label: "open_session" | "confirm" | "review_error";
  };
  sensitivity: "public" | "private";
  progress?: { completed: number; total: number };
};

export type PetSessionUpdate = {
  sessionKey: string;
  runId: string;
  sessionLabel: string;
  sequence: number;
  timestamp: number;
  state: PetSessionState;
  phase: DesktopPetActivityPhase;
  action: string;
  animation?: DesktopPetAction;
  priority?: "low" | "normal" | "high";
  detail?: string;
  progress?: { completed: number; total: number };
  outputTail?: string;
  outputLines?: string[];
  /** Explicitly safe for an ambient desktop surface. Never infer this from raw tool output. */
  publicSummary?: string;
  feedback?: PetFeedback;
};
