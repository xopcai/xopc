import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BrowserWindow,
  app,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type Rectangle,
} from 'electron';

import { createDesktopPetPackage } from '../../src/pets/factory.js';
import {
  desktopPetCustomDir,
  patchDesktopPetPrefs,
  readDesktopPetPrefs,
  readDesktopPetState,
} from './prefs.js';
import type {
  DesktopPetCreateRequest,
  DesktopPetCreateResult,
  DesktopPetDragPoint,
  DesktopPetEvent,
  DesktopPetPrefs,
  DesktopPetState,
} from './types.js';
import { clampDesktopPetBounds, desktopPetDefaultBounds } from './window-bounds.js';

type DesktopPetRuntime = {
  resolveUrl: () => string | null;
  openMainWindow: (hashPath?: string) => void;
  disableSandbox: boolean;
};

let runtime: DesktopPetRuntime | null = null;
let petWindow: BrowserWindow | null = null;
let boundsSaveTimer: NodeJS.Timeout | null = null;
let dragState: { startPoint: DesktopPetDragPoint; startBounds: Rectangle } | null = null;

function scaleFromPrefs(prefs: DesktopPetPrefs): number {
  return Math.min(1.4, Math.max(0.7, prefs.sizePercent / 100));
}

function defaultBounds(prefs: DesktopPetPrefs): Rectangle {
  const display = screen.getPrimaryDisplay().workArea;
  return desktopPetDefaultBounds(display, scaleFromPrefs(prefs));
}

function clampBounds(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds).workArea;
  return clampDesktopPetBounds(bounds, display);
}

async function getInitialBounds(): Promise<Rectangle> {
  const prefs = await readDesktopPetPrefs();
  const fallback = defaultBounds(prefs);
  return clampBounds({ ...fallback, ...(prefs.bounds ?? {}) });
}

function emitStateChanged(): void {
  void getDesktopPetState().then((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('desktop-pet:state-changed', state);
      }
    }
  });
}

function scheduleBoundsSave(win: BrowserWindow): void {
  if (boundsSaveTimer) {
    clearTimeout(boundsSaveTimer);
  }
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null;
    if (win.isDestroyed()) return;
    void patchDesktopPetPrefs({ bounds: win.getBounds() }).then(() => emitStateChanged());
  }, 350);
}

async function createPetWindow(): Promise<BrowserWindow | null> {
  if (!runtime) return null;
  if (petWindow && !petWindow.isDestroyed()) return petWindow;

  const href = runtime.resolveUrl();
  if (!href) return null;

  const prefs = await readDesktopPetPrefs();
  const bounds = await getInitialBounds();
  const options: BrowserWindowConstructorOptions = {
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    fullscreenable: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      ...(runtime.disableSandbox ? { sandbox: false } : {}),
    },
  };
  const win = new BrowserWindow(options);
  petWindow = win;
  win.setAlwaysOnTop(prefs.alwaysOnTop, 'floating');
  win.on('move', () => scheduleBoundsSave(win));
  win.on('closed', () => {
    if (petWindow === win) petWindow = null;
    emitStateChanged();
  });
  win.webContents.on('did-finish-load', () => emitStateChanged());
  await win.loadURL(href);
  return win;
}

export function initDesktopPetWindow(runtimeOptions: DesktopPetRuntime): void {
  runtime = runtimeOptions;
}

export async function maybeShowDesktopPetOnStartup(): Promise<void> {
  const prefs = await readDesktopPetPrefs();
  if (prefs.enabled && prefs.showOnStartup) {
    await showDesktopPet();
  }
}

export async function showDesktopPet(): Promise<void> {
  const prefs = await patchDesktopPetPrefs({ enabled: true });
  const win = await createPetWindow();
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(prefs.alwaysOnTop, 'floating');
  win.setBounds(clampBounds({ ...defaultBounds(prefs), ...(prefs.bounds ?? {}) }));
  win.showInactive();
  emitStateChanged();
}

export function hideDesktopPet(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
  emitStateChanged();
}

export async function toggleDesktopPet(): Promise<void> {
  if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
    hideDesktopPet();
    return;
  }
  await showDesktopPet();
}

export async function applyDesktopPetPrefs(patch: Partial<DesktopPetPrefs>): Promise<DesktopPetState> {
  const prefs = await patchDesktopPetPrefs(patch);
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setAlwaysOnTop(prefs.alwaysOnTop, 'floating');
    if (patch.sizePercent !== undefined) {
      const fallback = defaultBounds(prefs);
      const resizedBounds = clampBounds({
        ...fallback,
        x: prefs.bounds?.x ?? fallback.x,
        y: prefs.bounds?.y ?? fallback.y,
      });
      petWindow.setBounds(resizedBounds);
      await patchDesktopPetPrefs({ bounds: resizedBounds });
    }
    if (!prefs.enabled) {
      petWindow.hide();
    }
  } else if (prefs.enabled) {
    await showDesktopPet();
  }
  const state = await getDesktopPetState();
  emitStateChanged();
  return state;
}

export async function resetDesktopPetPosition(): Promise<DesktopPetState> {
  const prefs = await readDesktopPetPrefs();
  const bounds = defaultBounds({ ...prefs, bounds: undefined });
  const next = await patchDesktopPetPrefs({ bounds });
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setBounds(clampBounds(bounds));
  }
  const state = await readDesktopPetState(Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()));
  state.prefs = next;
  emitStateChanged();
  return state;
}

export async function getDesktopPetState(): Promise<DesktopPetState> {
  return readDesktopPetState(Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()));
}

export async function sendDesktopPetEvent(event: DesktopPetEvent): Promise<void> {
  const payload: DesktopPetEvent = {
    ...event,
    id: event.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: event.createdAt ?? Date.now(),
  };
  const prefs = await readDesktopPetPrefs();
  if (!prefs.enabled) return;
  const win = await createPetWindow();
  if (win && !win.isDestroyed()) {
    if (!win.isVisible()) {
      win.showInactive();
    }
    win.webContents.send('desktop-pet:event', payload);
  }
}

export function setDesktopPetClickThrough(enabled: boolean): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  try {
    petWindow.setIgnoreMouseEvents(enabled, { forward: true });
  } catch {
    petWindow.setIgnoreMouseEvents(enabled);
  }
}

export function openDesktopPetMainWindow(hashPath?: string): void {
  runtime?.openMainWindow(hashPath);
}

export async function openDesktopPetCustomDir(): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = desktopPetCustomDir();
  await mkdir(target, { recursive: true });
  const message = await shell.openPath(target);
  return message ? { ok: false, error: message } : { ok: true };
}

export async function createDesktopPetFromPrompt(
  request: DesktopPetCreateRequest,
): Promise<DesktopPetCreateResult> {
  const result = await createDesktopPetPackage({
    name: request.name,
    prompt: request.prompt,
    description: request.description,
    targetDir: desktopPetCustomDir(),
    overwrite: request.overwrite,
  });
  emitStateChanged();
  return {
    id: `custom:${result.id}`,
    name: result.name,
    dir: result.dir,
    manifestPath: result.manifestPath,
    sourcePrompt: result.sourcePrompt,
  };
}

function isFiniteDragPoint(point: DesktopPetDragPoint): boolean {
  return Number.isFinite(point.screenX) && Number.isFinite(point.screenY);
}

export function startDesktopPetDrag(point: DesktopPetDragPoint): void {
  if (!petWindow || petWindow.isDestroyed() || !isFiniteDragPoint(point)) return;
  dragState = {
    startPoint: { screenX: point.screenX, screenY: point.screenY },
    startBounds: petWindow.getBounds(),
  };
}

export function dragDesktopPet(point: DesktopPetDragPoint): void {
  if (!petWindow || petWindow.isDestroyed() || !dragState || !isFiniteDragPoint(point)) return;
  const dx = Math.round(point.screenX - dragState.startPoint.screenX);
  const dy = Math.round(point.screenY - dragState.startPoint.screenY);
  petWindow.setBounds(
    clampBounds({
      ...dragState.startBounds,
      x: dragState.startBounds.x + dx,
      y: dragState.startBounds.y + dy,
    }),
  );
}

export async function endDesktopPetDrag(): Promise<void> {
  if (!dragState) return;
  dragState = null;
  if (!petWindow || petWindow.isDestroyed()) return;
  await patchDesktopPetPrefs({ bounds: petWindow.getBounds() });
  emitStateChanged();
}

export function destroyDesktopPetWindow(): void {
  if (boundsSaveTimer) {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = null;
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
  }
  petWindow = null;
}
