export interface ElectronOpenDirectoryOptions {
  defaultPath?: string;
}

export interface ElectronFileAPI {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean }>;
  listDirectory(
    dirPath: string,
  ): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
  openDirectory(options?: ElectronOpenDirectoryOptions): Promise<string | null>;
  pickEndpointFile(): Promise<{
    name: string;
    mimeType: string;
    size: number;
    dataBase64: string;
  } | null>;
  saveEndpointText(input: {
    suggestedName: string;
    content: string;
  }): Promise<{ saved: true; name: string } | { saved: false }>;
  watchFile(filePath: string, callback: (content: string) => void): void;
}

export interface ElectronSearchAPI {
  ripgrep(
    query: string,
    dirPath: string,
  ): Promise<
    Array<{
      filePath: string;
      lineNumber: number;
      lineContent: string;
      matchStart: number;
      matchEnd: number;
    }>
  >;
}

export interface ElectronAgentAPI {
  sendMessage(
    message: string,
    sessionKey: string,
  ): Promise<{ done: boolean; error?: string }>;
  onStream(callback: (chunk: string) => void): void;
}

export interface ElectronTerminalDescriptor {
  terminalId: string;
  sessionKey: string;
  sessionId: string;
  terminalKey: string;
  cwd: string;
  replay: string;
  replaySequence: number;
  exited: boolean;
  exitCode?: number;
  signal?: number;
}

export interface ElectronTerminalAPI {
  create(input: {
    sessionKey: string;
    sessionId: string;
    terminalKey: string;
    cols: number;
    rows: number;
  }): Promise<ElectronTerminalDescriptor>;
  write(terminalId: string, data: string): void;
  resize(terminalId: string, cols: number, rows: number): Promise<{ ok: true }>;
  dispose(sessionId: string, terminalKey: string): Promise<{ ok: true }>;
  onData(callback: (event: { terminalId: string; data: string; sequence: number }) => void): () => void;
  onExit(callback: (event: { terminalId: string; exitCode: number; signal: number }) => void): () => void;
  onError(callback: (event: { terminalId?: string; message: string }) => void): () => void;
}

export interface ElectronStartupAPI {
  onProgress(
    callback: (detail: {
      phase:
        | 'preparing-workspace'
        | 'checking-core'
        | 'starting-core'
        | 'connecting-assistant'
        | 'opening-workspace';
    }) => void,
  ): () => void;
}

export interface ElectronGatewayShellAPI {
  getCredential(): Promise<string | undefined>;
  onExited(
    callback: (detail: { code: number | null; signal: string | null }) => void,
  ): () => void;
  restart(): Promise<{
    ok: boolean;
    message?: string;
    token?: string;
    port?: number;
  }>;
}

export type ElectronShellOpenResult =
  | { ok: true; error?: undefined; code?: undefined }
  | {
      ok: false;
      error: string;
      code?:
        | "CANCELED"
        | "INVALID_FILE"
        | "INVALID_PATH"
        | "NOT_FOUND"
        | "NOT_FILE"
        | "INVALID_APP"
        | "TOO_LARGE"
        | "WRITE_FAILED"
        | "OPEN_FAILED"
        | string;
    };

export type ElectronRecentOpenWithApp = {
  name: string;
  path: string;
  platform: "darwin" | "win32" | "linux" | string;
  lastUsedAt: number;
};

export type ElectronRecommendedOpenWithApp = {
  name: string;
  path: string;
  platform: "darwin" | "win32" | "linux" | string;
  source: "known";
};

export interface ElectronShellAPI {
  openExternalUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }>;
  openPath(filePath: string): Promise<ElectronShellOpenResult>;
  openFileResource(fileResourceId: string): Promise<ElectronShellOpenResult>;
  openTemporaryFile(input: {
    fileName: string;
    data: Uint8Array;
  }): Promise<ElectronShellOpenResult>;
  showItemInFolder(filePath: string): Promise<{ success: boolean }>;
  showFileResourceInFolder(fileResourceId: string): Promise<{ success: boolean; error?: string }>;
  trashFileResource(fileResourceId: string): Promise<ElectronShellOpenResult>;
  chooseAppAndOpenPath(filePath: string): Promise<ElectronShellOpenResult>;
  chooseAppAndOpenFileResource(fileResourceId: string): Promise<ElectronShellOpenResult>;
  openPathWithApp(
    filePath: string,
    appPath: string,
  ): Promise<ElectronShellOpenResult>;
  openFileResourceWithApp(fileResourceId: string, appPath: string): Promise<ElectronShellOpenResult>;
  getRecentOpenWithApps(): Promise<ElectronRecentOpenWithApp[]>;
  getOpenWithAppsForPath(filePath: string): Promise<{
    recommended: ElectronRecommendedOpenWithApp[];
    recent: ElectronRecentOpenWithApp[];
  }>;
  getOpenWithAppsForFileResource(fileResourceId: string): Promise<{
    recommended: ElectronRecommendedOpenWithApp[];
    recent: ElectronRecentOpenWithApp[];
  }>;
  clearRecentOpenWithApps(): Promise<{ ok: true }>;
}

export interface ElectronClipboardAPI {
  writeText(text: string): Promise<boolean>;
  readText(): Promise<string>;
}

export type TccTriState = "granted" | "denied" | "unknown";

export type ShellPermissionSnapshot = {
  fullDisk: TccTriState;
  screen: TccTriState;
  microphone: TccTriState;
  accessibility: TccTriState;
  automation: TccTriState;
  notifications: TccTriState;
  location: TccTriState;
};

export type PrivacyPaneKind =
  | "fullDisk"
  | "screen"
  | "microphone"
  | "accessibility"
  | "automation"
  | "notifications"
  | "location"
  | "camera";

export type SystemSettingsBehavior = {
  platform: "darwin" | "win32" | "linux";
  /** False when running unpackaged (e.g. electron:dev); macOS privacy lists may show "Electron". */
  packaged: boolean;
  openAtLogin: boolean;
  openAsHidden: boolean;
  keepAwakeEnabled: boolean;
  keepAwakePreferred: boolean;
  notifyEnabled: boolean;
  notifySoundEnabled: boolean;
};

export type UninstallMode = "manual" | "native-uninstaller" | "unsupported";

export type LinuxPackageKind = "appimage" | "deb" | "unknown";

export type UninstallErrorCode =
  | "PENDING_UPDATE"
  | "NOT_PACKAGED"
  | "UNINSTALLER_NOT_FOUND"
  | "PLATFORM_UNSUPPORTED";

export type UninstallInfo = {
  packaged: boolean;
  platform: "darwin" | "win32" | "linux";
  uninstallMode: UninstallMode;
  appPath: string;
  dataPath: string;
  dataSizeBytes: number | null;
  uninstallerPath: string | null;
  pendingUpdate: boolean;
  linuxPackageKind?: LinuxPackageKind;
  linuxDebPackageName?: string;
};

export type UninstallAppResult =
  | {
      ok: true;
      mode: "manual" | "native-uninstaller";
      linuxPackageKind?: LinuxPackageKind;
      debPackageName?: string;
    }
  | { ok: false; error: UninstallErrorCode };

export type ClearUserDataResult =
  | { ok: true }
  | { ok: false; error: UninstallErrorCode };

export type PermissionRequestOutcome =
  | "granted"
  | "denied"
  | "prompted"
  | "opened-settings"
  | "already-granted";

export type PermissionRequestResult = {
  status: TccTriState;
  outcome: PermissionRequestOutcome;
};

export type ElectronMenuItemModel =
  | { type: "separator" }
  | {
      type: "item";
      id: string;
      label: string;
      accelerator?: string;
      role?: string;
    };

export type ElectronMenuGroupModel = {
  id: string;
  label: string;
  items: ElectronMenuItemModel[];
};

export interface ElectronMenuAPI {
  getModel(): Promise<ElectronMenuGroupModel[]>;
  invoke(
    id: string,
  ): Promise<{ ok: true } | { ok: false; error: "UNKNOWN_MENU_ACTION" }>;
  onNavigate(callback: (path: string) => void): () => void;
  onTogglePalette(callback: () => void): () => void;
  onQuickCapture(callback: () => void): () => void;
  onToggleSidebar(callback: () => void): () => void;
  onHistoryNavigate(callback: (delta: -1 | 1) => void): () => void;
}

export interface ElectronVoiceInputHotkeyAPI {
  onEvent(callback: (action: "press" | "release") => void): () => void;
}

export type ElectronUiLanguage = "en" | "zh";

export interface ElectronLocaleAPI {
  getLanguage(): Promise<ElectronUiLanguage>;
  setLanguage(
    language: ElectronUiLanguage,
  ): Promise<{ ok: true; language: ElectronUiLanguage }>;
  onChanged(callback: (language: ElectronUiLanguage) => void): () => void;
}

export interface ElectronCronDisplayWakeAPI {
  setDisplaySleepPrevented(enabled: boolean): Promise<void>;
}

export interface ElectronFullscreenAPI {
  enter(): Promise<void>;
  exit(): Promise<void>;
  toggle(): Promise<void>;
  isFullscreen(): Promise<boolean>;
  onChange(callback: (isFullscreen: boolean) => void): () => void;
}

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

export type DesktopPetPersonaTone = "calm" | "warm" | "playful" | "focused";

export type DesktopPetPersona = {
  tone: DesktopPetPersonaTone;
  warmth: number;
  energy: number;
  humor: number;
  phrases?: {
    greeting?: string[];
    success?: string[];
    waiting?: string[];
    error?: string[];
  };
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
  publicSummary?: string;
  feedback?: PetFeedback;
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

export interface ElectronDesktopPetAPI {
  getState(): Promise<DesktopPetState>;
  setPrefs(patch: Partial<DesktopPetPrefs>): Promise<DesktopPetState>;
  show(): Promise<void>;
  hide(): Promise<void>;
  toggle(): Promise<void>;
  resetPosition(): Promise<DesktopPetState>;
  openMainWindow(path?: string): Promise<void>;
  setClickThrough(enabled: boolean): Promise<void>;
  sendEvent(event: PetSessionUpdate): Promise<void>;
  acknowledgeEvent(sessionKey: string, runId: string): Promise<void>;
  openCustomPetsDir(): Promise<{ ok: true } | { ok: false; error: string }>;
  createFromPrompt(
    request: DesktopPetCreateRequest,
  ): Promise<
    { ok: true; result: DesktopPetCreateResult } | { ok: false; error: string }
  >;
  startDrag(point: DesktopPetDragPoint): Promise<void>;
  drag(point: DesktopPetDragPoint): Promise<void>;
  endDrag(): Promise<void>;
  setContentSize(size: DesktopPetContentSize): Promise<void>;
  onStateChanged(callback: (state: DesktopPetState) => void): () => void;
  onEvent(callback: (event: PetSessionUpdate) => void): () => void;
}

export interface ElectronSystemSettingsAPI {
  getBehavior(): Promise<SystemSettingsBehavior>;
  setBehavior(patch: {
    openAtLogin?: boolean;
    openAsHidden?: boolean;
    keepAwakePreferred?: boolean;
    notifyEnabled?: boolean;
    notifySoundEnabled?: boolean;
  }): Promise<{ ok: true; behavior: SystemSettingsBehavior }>;
  getPermissions(options?: {
    probe?: boolean;
  }): Promise<ShellPermissionSnapshot>;
  openPrivacy(
    kind: PrivacyPaneKind,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  requestMicrophone(): Promise<PermissionRequestResult>;
  requestAccessibility(): Promise<PermissionRequestResult>;
  requestNotifications(): Promise<PermissionRequestResult>;
  showEndpointNotification(input: {
    title: string;
    body: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  showProductNotification(input: {
    id: string;
    title: string;
    body: string;
    target: import('@xopcai/gateway-contract').NotificationTarget;
  }): Promise<
    { ok: true; outcome: 'shown' | 'suppressed-focused' }
    | { ok: false; error: string }
  >;
  requestScreen(): Promise<PermissionRequestResult>;
  getUninstallInfo(): Promise<UninstallInfo>;
  clearUserData(): Promise<ClearUserDataResult>;
  uninstallApp(options?: {
    removeUserData?: boolean;
  }): Promise<UninstallAppResult>;
}

export type ElectronUnderstandingSourceCategory = 'files' | 'recent_documents' | 'calendar' | 'tasks' | 'notes' | 'mail' | 'messages' | 'code_activity';
export interface ElectronUnderstandingSourceDefinition {
  id: string; category: ElectronUnderstandingSourceCategory; platform: 'darwin' | 'win32' | 'linux' | 'all';
  displayName: string; description: string; availability: 'available' | 'unavailable';
  permission: 'not_requested' | 'granted' | 'denied' | 'unavailable'; defaultAccessMode: 'once' | 'continuous';
  supportedAccessModes: Array<'once' | 'continuous'>; recommended: boolean; sensitive: boolean;
}
export interface ElectronUnderstandingSourceItem {
  id: string; sourceId: string; type: 'document' | 'calendar_event' | 'task' | 'note' | 'mail' | 'message' | 'code_activity' | 'bookmark';
  title: string; text?: string; group?: string; resourceUri?: string; occurredAt?: number; modifiedAt?: number; startsAt?: number; endsAt?: number;
  ownerAttribution: 'user' | 'other' | 'shared' | 'unknown'; sensitivity: 'normal' | 'personal' | 'secret' | 'regulated'; evidenceRef: string;
}
export interface ElectronUnderstandingSourceCollectionResult {
  sourceId: string; status: 'completed' | 'denied' | 'failed'; items: ElectronUnderstandingSourceItem[];
  checkpoint?: { fingerprint: string; collectedAt: number }; error?: string;
}
export interface ElectronUnderstandingSourcesAPI {
  catalog(): Promise<ElectronUnderstandingSourceDefinition[]>;
  collect(sourceIds: string[]): Promise<ElectronUnderstandingSourceCollectionResult[]>;
}

export interface ElectronAPI {
  clipboard?: ElectronClipboardAPI;
  shell?: ElectronShellAPI;
  file: ElectronFileAPI;
  search: ElectronSearchAPI;
  agent: ElectronAgentAPI;
  terminal?: ElectronTerminalAPI;
  understandingSources?: ElectronUnderstandingSourcesAPI;
  startup?: ElectronStartupAPI;
  gateway?: ElectronGatewayShellAPI;
  platform: "darwin" | "win32" | "linux";
  voiceInputHotkey?: ElectronVoiceInputHotkeyAPI;
  menu?: ElectronMenuAPI;
  locale?: ElectronLocaleAPI;
  cron?: ElectronCronDisplayWakeAPI;
  fullscreen?: ElectronFullscreenAPI;
  pet?: ElectronDesktopPetAPI;
  system?: ElectronSystemSettingsAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
