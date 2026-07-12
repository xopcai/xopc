import type { IpcMain } from 'electron';

import { assertTrustedRenderer } from '../ipc/trusted-renderer.js';
import {
  applyDesktopPetPrefs,
  createDesktopPetFromPrompt,
  dragDesktopPet,
  endDesktopPetDrag,
  getDesktopPetState,
  hideDesktopPet,
  openDesktopPetCustomDir,
  openDesktopPetMainWindow,
  resetDesktopPetPosition,
  sendDesktopPetEvent,
  setDesktopPetClickThrough,
  showDesktopPet,
  startDesktopPetDrag,
  toggleDesktopPet,
} from './window.js';
import type { DesktopPetCreateRequest, DesktopPetDragPoint, DesktopPetEvent, DesktopPetPrefs } from './types.js';

function isDesktopPetEvent(value: unknown): value is DesktopPetEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<DesktopPetEvent>;
  return typeof event.kind === 'string';
}

function isDragPoint(value: unknown): value is DesktopPetDragPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<DesktopPetDragPoint>;
  return typeof point.screenX === 'number' && typeof point.screenY === 'number';
}

function normalizeInternalPath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') ? value : '/chat';
}

function normalizeCreateRequest(value: unknown): DesktopPetCreateRequest | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
  if (!prompt) return null;
  const request: DesktopPetCreateRequest = { prompt };
  if (typeof record.name === 'string' && record.name.trim()) request.name = record.name.trim();
  if (typeof record.description === 'string' && record.description.trim()) {
    request.description = record.description.trim();
  }
  if (record.overwrite === true) request.overwrite = true;
  return request;
}

export function registerDesktopPetIpc(ipcMain: IpcMain): void {
  ipcMain.handle('desktop-pet:get-state', async (event) => {
    assertTrustedRenderer(event);
    return getDesktopPetState();
  });
  ipcMain.handle('desktop-pet:set-prefs', async (event, patch: Partial<DesktopPetPrefs>) => {
    assertTrustedRenderer(event);
    return applyDesktopPetPrefs(patch && typeof patch === 'object' ? patch : {});
  });
  ipcMain.handle('desktop-pet:show', async (event) => {
    assertTrustedRenderer(event);
    await showDesktopPet();
  });
  ipcMain.handle('desktop-pet:hide', (event) => {
    assertTrustedRenderer(event);
    hideDesktopPet();
  });
  ipcMain.handle('desktop-pet:toggle', async (event) => {
    assertTrustedRenderer(event);
    await toggleDesktopPet();
  });
  ipcMain.handle('desktop-pet:reset-position', async (event) => {
    assertTrustedRenderer(event);
    return resetDesktopPetPosition();
  });
  ipcMain.handle('desktop-pet:open-main-window', (event, hashPath?: unknown) => {
    assertTrustedRenderer(event);
    openDesktopPetMainWindow(normalizeInternalPath(hashPath));
  });
  ipcMain.handle('desktop-pet:set-click-through', (event, enabled: unknown) => {
    assertTrustedRenderer(event);
    setDesktopPetClickThrough(enabled === true);
  });
  ipcMain.handle('desktop-pet:send-event', async (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (isDesktopPetEvent(value)) {
      await sendDesktopPetEvent(value);
    }
  });
  ipcMain.handle('desktop-pet:open-custom-dir', async (event) => {
    assertTrustedRenderer(event);
    return openDesktopPetCustomDir();
  });
  ipcMain.handle('desktop-pet:create-from-prompt', async (event, value: unknown) => {
    assertTrustedRenderer(event);
    const request = normalizeCreateRequest(value);
    if (!request) {
      return { ok: false, error: 'prompt is required' };
    }
    try {
      const result = await createDesktopPetFromPrompt(request);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('desktop-pet:drag-start', (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (isDragPoint(value)) startDesktopPetDrag(value);
  });
  ipcMain.handle('desktop-pet:drag-move', (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (isDragPoint(value)) dragDesktopPet(value);
  });
  ipcMain.handle('desktop-pet:drag-end', async (event) => {
    assertTrustedRenderer(event);
    await endDesktopPetDrag();
  });
}
