export type ScreenshotLanguage = 'zh' | 'en';

export interface ScreenshotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface SnapWindowRect extends ScreenshotRect {
  id: string;
  title: string;
  appName: string;
  zOrder: number;
}

export interface DisplayCaptureFrame {
  displayId: number;
  bounds: ScreenshotRect;
  scaleFactor: number;
  pixelWidth: number;
  pixelHeight: number;
  /** PNG data URL or base64 payload representing the frozen display frame. */
  pngBase64: string;
  /** Viewport bounds of an aspect-fitted multi-display capture, anchored at (0, 0). */
  imageBounds?: ScreenshotRect;
  /** Optional pre-selected region (e.g. Wayland interactive portal fallback). */
  initialSelection?: ScreenshotRect;
}

export type AnnotationTool =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'mosaic'
  | 'badge'
  | 'text';

export type StrokeSizePreset = 'sm' | 'md' | 'lg';

export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface BaseAnnotationItem {
  id: string;
  color: string;
  strokeSize: StrokeSizePreset;
}

export interface BoxAnnotationItem extends BaseAnnotationItem {
  kind: 'rect' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineAnnotationItem extends BaseAnnotationItem {
  kind: 'arrow' | 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PenAnnotationItem extends BaseAnnotationItem {
  kind: 'pen' | 'mosaic';
  points: AnnotationPoint[];
}

export interface BadgeAnnotationItem extends BaseAnnotationItem {
  kind: 'badge';
  x: number;
  y: number;
  number: number;
}

export interface TextAnnotationItem extends BaseAnnotationItem {
  kind: 'text';
  x: number;
  y: number;
  text: string;
}

export type AnnotationItem =
  | BoxAnnotationItem
  | LineAnnotationItem
  | PenAnnotationItem
  | BadgeAnnotationItem
  | TextAnnotationItem;

export interface ScreenshotPreferences {
  hideMainWindow: boolean;
}

export interface ScreenshotOverlayPayload {
  sessionId: string;
  displayId: number;
  bounds: ScreenshotRect;
  scaleFactor: number;
  pixelWidth: number;
  pixelHeight: number;
  pngBase64: string;
  windows: SnapWindowRect[];
  language: ScreenshotLanguage;
  platform: NodeJS.Platform;
  isWayland: boolean;
  imageBounds?: ScreenshotRect;
  initialSelection?: ScreenshotRect;
}

export interface ScreenshotOcrBlock {
  text: string;
  /** Normalized 0..1 coordinates within the cropped image when available. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence?: number;
}

export interface ScreenshotOcrResponse {
  ok: boolean;
  text: string;
  blocks?: ScreenshotOcrBlock[];
  engine: 'vision' | 'winrt' | 'tesseract' | 'ai';
  model?: string;
  error?: string;
}

export interface ScreenshotTranslateItem {
  source: string;
  translation: string;
}

export interface ScreenshotTranslateResponse {
  ok: boolean;
  sourceText: string;
  translatedText: string;
  targetLanguage: string;
  items?: ScreenshotTranslateItem[];
  model?: string;
  error?: string;
}

export interface ScrollCaptureProgress {
  sessionId: string;
  active: boolean;
  autoScrolling: boolean;
  autoScrollSupported: boolean;
  frameCount: number;
  pixelWidth: number;
  pixelHeight: number;
  previewPngBase64?: string;
  reachedLimit?: boolean;
  statusMessage?: string;
}

export interface PinWindowPayload {
  pinId: string;
  pngBase64: string;
  width: number;
  height: number;
  scaleFactor: number;
  language: ScreenshotLanguage;
  alwaysOnTop: boolean;
  opacity: number;
}

export interface ScreenshotChatDelivery {
  id: string;
  createdAt: number;
  pngBase64: string;
  fileName: string;
  width: number;
  height: number;
  prompt?: string;
  targetMode: 'chat' | 'note';
}

export interface ScreenshotHistoryItem {
  id: string;
  createdAt: number;
  width: number;
  height: number;
  action: 'copy' | 'save' | 'pin' | 'chat' | 'note';
  previewDataUrl: string;
}
