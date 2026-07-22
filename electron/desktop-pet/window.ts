import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  BrowserWindow,
  app,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type Rectangle,
} from "electron";

import { createDesktopPetPackage } from "../../src/pets/factory.js";
import {
  desktopPetCustomDir,
  patchDesktopPetPrefs,
  readDesktopPetPrefs,
  readDesktopPetState,
} from "./prefs.js";
import type {
  DesktopPetAnchor,
  DesktopPetContentSize,
  DesktopPetCreateRequest,
  DesktopPetCreateResult,
  DesktopPetDragPoint,
  PetSessionUpdate,
  DesktopPetPrefs,
  DesktopPetState,
} from "./types.js";
import {
  clampDesktopPetAnchor,
  desktopPetDefaultAnchor,
  desktopPetWindowBoundsForAnchor,
} from "./window-bounds.js";

type DesktopPetRuntime = {
  resolveUrl: () => string | null;
  openMainWindow: (hashPath?: string) => void;
  disableSandbox: boolean;
};

let runtime: DesktopPetRuntime | null = null;
let petWindow: BrowserWindow | null = null;
let dragState: {
  startPoint: DesktopPetDragPoint;
  startAnchor: DesktopPetAnchor;
} | null = null;
let contentSize: DesktopPetContentSize = { width: 138, height: 132 };
let interactiveSize: DesktopPetContentSize = { width: 138, height: 132 };
const recentActivities = new Map<string, PetSessionUpdate>();
const RECENT_SUCCESS_TTL_MS = 60_000;
const MAX_RECENT_ACTIVITIES = 12;

function currentActivities(now = Date.now()): PetSessionUpdate[] {
  for (const [sessionKey, activity] of recentActivities) {
    if (activity.state === "success" && now - activity.timestamp > RECENT_SUCCESS_TTL_MS) {
      recentActivities.delete(sessionKey);
    }
  }
  return [...recentActivities.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_RECENT_ACTIVITIES);
}

function rememberActivity(event: PetSessionUpdate): void {
  const prior = recentActivities.get(event.sessionKey);
  if (prior && prior.runId === event.runId && event.sequence <= prior.sequence) return;
  recentActivities.set(event.sessionKey, event);
  const retained = currentActivities();
  if (recentActivities.size <= MAX_RECENT_ACTIVITIES) return;
  recentActivities.clear();
  for (const activity of retained) recentActivities.set(activity.sessionKey, activity);
}

function scaleFromPrefs(prefs: DesktopPetPrefs): number {
  return Math.min(1.4, Math.max(0.7, prefs.sizePercent / 100));
}

function defaultContentSize(prefs: DesktopPetPrefs): DesktopPetContentSize {
  const stageSize = Math.round(132 * scaleFromPrefs(prefs));
  return {
    width: stageSize + Math.round(6 * scaleFromPrefs(prefs)),
    height: stageSize,
  };
}

function updateInteractiveSize(prefs: DesktopPetPrefs): void {
  interactiveSize = defaultContentSize(prefs);
}

function clampAnchor(anchor: DesktopPetAnchor): DesktopPetAnchor {
  const display = screen.getDisplayNearestPoint(anchor).workArea;
  return clampDesktopPetAnchor(
    anchor,
    display,
    interactiveSize.width,
    interactiveSize.height,
  );
}

function boundsForAnchor(anchor: DesktopPetAnchor): Rectangle {
  return desktopPetWindowBoundsForAnchor(anchor, contentSize);
}

async function getInitialAnchor(): Promise<DesktopPetAnchor> {
  const prefs = await readDesktopPetPrefs();
  return clampAnchor(
    prefs.anchor ??
      desktopPetDefaultAnchor(screen.getPrimaryDisplay().workArea),
  );
}

function emitStateChanged(): void {
  void getDesktopPetState().then((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("desktop-pet:state-changed", state);
      }
    }
  });
}

async function createPetWindow(): Promise<BrowserWindow | null> {
  if (!runtime) return null;
  if (petWindow && !petWindow.isDestroyed()) return petWindow;

  const href = runtime.resolveUrl();
  if (!href) return null;

  const prefs = await readDesktopPetPrefs();
  updateInteractiveSize(prefs);
  contentSize = defaultContentSize(prefs);
  const bounds = boundsForAnchor(await getInitialAnchor());
  const options: BrowserWindowConstructorOptions = {
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    fullscreenable: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      ...(runtime.disableSandbox ? { sandbox: false } : {}),
    },
  };
  const win = new BrowserWindow(options);
  petWindow = win;
  win.setAlwaysOnTop(prefs.alwaysOnTop, "floating");
  win.on("closed", () => {
    if (petWindow === win) petWindow = null;
    emitStateChanged();
  });
  win.webContents.on("did-finish-load", () => emitStateChanged());
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
  win.setAlwaysOnTop(prefs.alwaysOnTop, "floating");
  updateInteractiveSize(prefs);
  contentSize = defaultContentSize(prefs);
  win.setBounds(boundsForAnchor(await getInitialAnchor()));
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

export async function applyDesktopPetPrefs(
  patch: Partial<DesktopPetPrefs>,
): Promise<DesktopPetState> {
  const prefs = await patchDesktopPetPrefs(patch);
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setAlwaysOnTop(prefs.alwaysOnTop, "floating");
    if (patch.sizePercent !== undefined) {
      updateInteractiveSize(prefs);
      contentSize = defaultContentSize(prefs);
      petWindow.setBounds(boundsForAnchor(await getInitialAnchor()));
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
  const anchor = desktopPetDefaultAnchor(screen.getPrimaryDisplay().workArea);
  const next = await patchDesktopPetPrefs({ anchor });
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setBounds(boundsForAnchor(anchor));
  }
  const state = await readDesktopPetState(
    Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
  );
  state.prefs = next;
  emitStateChanged();
  return state;
}

export async function getDesktopPetState(): Promise<DesktopPetState> {
  const state = await readDesktopPetState(
    Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
  );
  return { ...state, activities: currentActivities() };
}

export async function sendDesktopPetEvent(event: PetSessionUpdate): Promise<void> {
  const prefs = await readDesktopPetPrefs();
  if (!prefs.enabled) return;
  rememberActivity(event);
  const win = petWindow && !petWindow.isDestroyed() ? petWindow : null;
  if (!win || !win.isVisible()) return;
  win.webContents.send("desktop-pet:event", event);
}

export function acknowledgeDesktopPetEvent(sessionKey: string, runId: string): void {
  const activity = recentActivities.get(sessionKey);
  if (activity?.runId === runId) recentActivities.delete(sessionKey);
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

export async function openDesktopPetCustomDir(): Promise<
  { ok: true } | { ok: false; error: string }
> {
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
  if (!petWindow || petWindow.isDestroyed() || !isFiniteDragPoint(point))
    return;
  dragState = {
    startPoint: { screenX: point.screenX, screenY: point.screenY },
    startAnchor: {
      x: petWindow.getBounds().x + contentSize.width,
      y: petWindow.getBounds().y + contentSize.height,
    },
  };
}

export function dragDesktopPet(point: DesktopPetDragPoint): void {
  if (
    !petWindow ||
    petWindow.isDestroyed() ||
    !dragState ||
    !isFiniteDragPoint(point)
  )
    return;
  const dx = Math.round(point.screenX - dragState.startPoint.screenX);
  const dy = Math.round(point.screenY - dragState.startPoint.screenY);
  petWindow.setBounds(
    boundsForAnchor(
      clampAnchor({
        x: dragState.startAnchor.x + dx,
        y: dragState.startAnchor.y + dy,
      }),
    ),
  );
}

export async function endDesktopPetDrag(): Promise<void> {
  if (!dragState) return;
  dragState = null;
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  await patchDesktopPetPrefs({
    anchor: {
      x: bounds.x + contentSize.width,
      y: bounds.y + contentSize.height,
    },
  });
  emitStateChanged();
}

export function setDesktopPetContentSize(next: DesktopPetContentSize): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (!Number.isFinite(next.width) || !Number.isFinite(next.height)) return;
  const width = Math.max(1, Math.round(next.width));
  const height = Math.max(1, Math.round(next.height));
  if (width === contentSize.width && height === contentSize.height) return;
  const bounds = petWindow.getBounds();
  const anchor = clampAnchor({
    x: bounds.x + contentSize.width,
    y: bounds.y + contentSize.height,
  });
  contentSize = { width, height };
  petWindow.setBounds(boundsForAnchor(anchor));
}

export function destroyDesktopPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
  }
  petWindow = null;
}
