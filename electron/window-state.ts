import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BrowserWindow, app, screen, type Rectangle } from 'electron';

const STATE_FILE_NAME = 'main-window-state.json';

export const MAIN_WINDOW_MIN_WIDTH = 1200;
export const MAIN_WINDOW_MIN_HEIGHT = 800;

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const MAX_INITIAL_WIDTH = 1560;
const MAX_INITIAL_HEIGHT = 960;
const INITIAL_WIDTH_RATIO = 0.7;
const INITIAL_HEIGHT_RATIO = 0.72;
const SAVE_DEBOUNCE_MS = 350;

type MainWindowStateFile = {
  version: 1;
  bounds?: Rectangle;
  isMaximized?: boolean;
  displayId?: number;
  updatedAt?: string;
};

export type InitialMainWindowState = {
  bounds: Rectangle;
  isMaximized: boolean;
};

let boundsSaveTimer: NodeJS.Timeout | null = null;

function statePath(): string {
  return join(app.getPath('userData'), STATE_FILE_NAME);
}

function clampToRange(value: number, min: number, max: number): number {
  if (max < min) return max;
  return Math.min(Math.max(value, min), max);
}

function normalizeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function normalizeBounds(value: unknown): Rectangle | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Rectangle>;
  const x = normalizeInteger(raw.x);
  const y = normalizeInteger(raw.y);
  const width = normalizeInteger(raw.width);
  const height = normalizeInteger(raw.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function readStateFile(): MainWindowStateFile | null {
  const path = statePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<MainWindowStateFile>;
    return {
      version: 1,
      bounds: normalizeBounds(parsed.bounds) ?? undefined,
      isMaximized: typeof parsed.isMaximized === 'boolean' ? parsed.isMaximized : false,
      displayId: normalizeInteger(parsed.displayId) ?? undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

function writeStateFile(state: MainWindowStateFile): void {
  try {
    writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  } catch {
    // Window state is a convenience cache; startup must not fail if it cannot be written.
  }
}

function displayForNewWindow() {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    return screen.getPrimaryDisplay();
  }
}

function defaultBounds(): Rectangle {
  const workArea = displayForNewWindow().workArea;
  const width = clampToRange(
    Math.round(workArea.width * INITIAL_WIDTH_RATIO),
    MAIN_WINDOW_MIN_WIDTH,
    Math.min(MAX_INITIAL_WIDTH, workArea.width),
  );
  const height = clampToRange(
    Math.round(workArea.height * INITIAL_HEIGHT_RATIO),
    MAIN_WINDOW_MIN_HEIGHT,
    Math.min(MAX_INITIAL_HEIGHT, workArea.height),
  );
  return {
    width: width || DEFAULT_WIDTH,
    height: height || DEFAULT_HEIGHT,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  };
}

function clampBoundsToDisplay(bounds: Rectangle): Rectangle {
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const width = clampToRange(bounds.width, MAIN_WINDOW_MIN_WIDTH, workArea.width);
  const height = clampToRange(bounds.height, MAIN_WINDOW_MIN_HEIGHT, workArea.height);
  return {
    width,
    height,
    x: clampToRange(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clampToRange(bounds.y, workArea.y, workArea.y + workArea.height - height),
  };
}

export function resolveInitialMainWindowState(): InitialMainWindowState {
  const saved = readStateFile();
  if (!saved?.bounds) {
    return { bounds: defaultBounds(), isMaximized: false };
  }
  return {
    bounds: clampBoundsToDisplay(saved.bounds),
    isMaximized: saved.isMaximized === true,
  };
}

function stateFromWindow(win: BrowserWindow): MainWindowStateFile | null {
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return null;
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return {
    version: 1,
    bounds: clampBoundsToDisplay(bounds),
    isMaximized: win.isMaximized(),
    displayId: display.id,
    updatedAt: new Date().toISOString(),
  };
}

function saveWindowState(win: BrowserWindow): void {
  const state = stateFromWindow(win);
  if (!state) return;
  writeStateFile(state);
}

function scheduleWindowStateSave(win: BrowserWindow): void {
  if (boundsSaveTimer) {
    clearTimeout(boundsSaveTimer);
  }
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null;
    saveWindowState(win);
  }, SAVE_DEBOUNCE_MS);
}

export function registerMainWindowStatePersistence(win: BrowserWindow): void {
  win.on('resize', () => scheduleWindowStateSave(win));
  win.on('move', () => scheduleWindowStateSave(win));
  win.on('maximize', () => saveWindowState(win));
  win.on('unmaximize', () => saveWindowState(win));
  win.on('close', () => saveWindowState(win));
}
