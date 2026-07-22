import type { IpcMain } from "electron";

import { assertTrustedRenderer } from "../ipc/trusted-renderer.js";
import { resolveDesktopPetMainWindowPath } from "./open-main-window-path.js";
import {
  acknowledgeDesktopPetEvent,
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
  setDesktopPetContentSize,
  showDesktopPet,
  startDesktopPetDrag,
  toggleDesktopPet,
} from "./window.js";
import type {
  DesktopPetCreateRequest,
  DesktopPetDragPoint,
  PetSessionUpdate,
  DesktopPetPrefs,
} from "./types.js";

function isPetSessionUpdate(value: unknown): value is PetSessionUpdate {
  if (!value || typeof value !== "object") return false;
  const update = value as Partial<PetSessionUpdate>;
  return typeof update.sessionKey === "string" && typeof update.runId === "string" && typeof update.sequence === "number" && typeof update.action === "string";
}

function isDragPoint(value: unknown): value is DesktopPetDragPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<DesktopPetDragPoint>;
  return typeof point.screenX === "number" && typeof point.screenY === "number";
}

function isContentSize(
  value: unknown,
): value is { width: number; height: number } {
  if (!value || typeof value !== "object") return false;
  const size = value as { width?: unknown; height?: unknown };
  return typeof size.width === "number" && typeof size.height === "number";
}

function normalizeCreateRequest(
  value: unknown,
): DesktopPetCreateRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt) return null;
  const request: DesktopPetCreateRequest = { prompt };
  if (typeof record.name === "string" && record.name.trim())
    request.name = record.name.trim();
  if (typeof record.description === "string" && record.description.trim()) {
    request.description = record.description.trim();
  }
  if (record.overwrite === true) request.overwrite = true;
  return request;
}

export function registerDesktopPetIpc(ipcMain: IpcMain): void {
  ipcMain.handle("desktop-pet:get-state", async (event) => {
    assertTrustedRenderer(event);
    return getDesktopPetState();
  });
  ipcMain.handle(
    "desktop-pet:set-prefs",
    async (event, patch: Partial<DesktopPetPrefs>) => {
      assertTrustedRenderer(event);
      return applyDesktopPetPrefs(
        patch && typeof patch === "object" ? patch : {},
      );
    },
  );
  ipcMain.handle("desktop-pet:show", async (event) => {
    assertTrustedRenderer(event);
    await showDesktopPet();
  });
  ipcMain.handle("desktop-pet:hide", (event) => {
    assertTrustedRenderer(event);
    hideDesktopPet();
  });
  ipcMain.handle("desktop-pet:toggle", async (event) => {
    assertTrustedRenderer(event);
    await toggleDesktopPet();
  });
  ipcMain.handle("desktop-pet:reset-position", async (event) => {
    assertTrustedRenderer(event);
    return resetDesktopPetPosition();
  });
  ipcMain.handle(
    "desktop-pet:open-main-window",
    (event, hashPath?: unknown) => {
      assertTrustedRenderer(event);
      openDesktopPetMainWindow(resolveDesktopPetMainWindowPath(hashPath));
    },
  );
  ipcMain.handle("desktop-pet:set-click-through", (event, enabled: unknown) => {
    assertTrustedRenderer(event);
    setDesktopPetClickThrough(enabled === true);
  });
  ipcMain.handle("desktop-pet:send-event", async (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (isPetSessionUpdate(value)) {
      await sendDesktopPetEvent(value);
    }
  });
  ipcMain.handle(
    "desktop-pet:ack-event",
    (event, sessionKey: unknown, runId: unknown) => {
      assertTrustedRenderer(event);
      if (typeof sessionKey === "string" && typeof runId === "string") {
        acknowledgeDesktopPetEvent(sessionKey, runId);
      }
    },
  );
  ipcMain.handle("desktop-pet:open-custom-dir", async (event) => {
    assertTrustedRenderer(event);
    return openDesktopPetCustomDir();
  });
  ipcMain.handle(
    "desktop-pet:create-from-prompt",
    async (event, value: unknown) => {
      assertTrustedRenderer(event);
      const request = normalizeCreateRequest(value);
      if (!request) {
        return { ok: false, error: "prompt is required" };
      }
      try {
        const result = await createDesktopPetFromPrompt(request);
        return { ok: true, result };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );
  ipcMain.handle("desktop-pet:drag-start", (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (isDragPoint(value)) startDesktopPetDrag(value);
  });
  ipcMain.handle("desktop-pet:drag-move", (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (isDragPoint(value)) dragDesktopPet(value);
  });
  ipcMain.handle("desktop-pet:drag-end", async (event) => {
    assertTrustedRenderer(event);
    await endDesktopPetDrag();
  });
  ipcMain.handle("desktop-pet:set-content-size", (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (isContentSize(value)) setDesktopPetContentSize(value);
  });
}
