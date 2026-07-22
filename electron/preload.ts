import { contextBridge, ipcRenderer } from "electron";

function notifyPreload(
  channel: "preload:ready" | "preload:dom-content-loaded",
): void {
  try {
    ipcRenderer.send(channel, { href: window.location.href });
  } catch {
    /* main process may not have registered diagnostics yet */
  }
}

contextBridge.exposeInMainWorld("electronAPI", {
  clipboard: {
    writeText: (text: string) =>
      ipcRenderer.invoke("clipboard:write-text", text) as Promise<boolean>,
    readText: () =>
      ipcRenderer.invoke("clipboard:read-text") as Promise<string>,
  },
  shell: {
    openPath: (filePath: string) =>
      ipcRenderer.invoke("shell:open-path", filePath) as Promise<
        { ok: true } | { ok: false; error: string; code?: string }
      >,
    showItemInFolder: (filePath: string) =>
      ipcRenderer.invoke("shell:show-item-in-folder", filePath) as Promise<{
        success: boolean;
      }>,
    chooseAppAndOpenPath: (filePath: string) =>
      ipcRenderer.invoke("shell:choose-app-and-open-path", filePath) as Promise<
        { ok: true } | { ok: false; error: string; code?: string }
      >,
    openPathWithApp: (filePath: string, appPath: string) =>
      ipcRenderer.invoke(
        "shell:open-path-with-app",
        filePath,
        appPath,
      ) as Promise<{ ok: true } | { ok: false; error: string; code?: string }>,
    getRecentOpenWithApps: () =>
      ipcRenderer.invoke("shell:get-recent-open-with-apps") as Promise<
        Array<{
          name: string;
          path: string;
          platform: string;
          lastUsedAt: number;
        }>
      >,
    getOpenWithAppsForPath: (filePath: string) =>
      ipcRenderer.invoke(
        "shell:get-open-with-apps-for-path",
        filePath,
      ) as Promise<{
        recommended: Array<{
          name: string;
          path: string;
          platform: string;
          source: "known";
        }>;
        recent: Array<{
          name: string;
          path: string;
          platform: string;
          lastUsedAt: number;
        }>;
      }>,
    clearRecentOpenWithApps: () =>
      ipcRenderer.invoke("shell:clear-recent-open-with-apps") as Promise<{
        ok: true;
      }>,
  },
  file: {
    readFile: (filePath: string) =>
      ipcRenderer.invoke("file:read", filePath) as Promise<string>,
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke("file:write", filePath, content) as Promise<{
        success: boolean;
      }>,
    listDirectory: (dirPath: string) =>
      ipcRenderer.invoke("file:list-dir", dirPath) as Promise<
        Array<{ name: string; path: string; isDirectory: boolean }>
      >,
    openDirectory: (options?: { defaultPath?: string }) =>
      ipcRenderer.invoke("file:open-dir-dialog", options) as Promise<
        string | null
      >,
    watchFile: (filePath: string, callback: (content: string) => void) => {
      const handler = (
        _: unknown,
        payload: { path: string; content: string },
      ) => {
        if (payload.path === filePath) callback(payload.content);
      };
      ipcRenderer.on("file:changed", handler);
      void ipcRenderer.invoke("file:watch", filePath);
    },
  },
  search: {
    ripgrep: (query: string, dirPath: string) =>
      ipcRenderer.invoke("search:ripgrep", query, dirPath) as Promise<
        Array<{
          filePath: string;
          lineNumber: number;
          lineContent: string;
          matchStart: number;
          matchEnd: number;
        }>
      >,
  },
  agent: {
    sendMessage: (message: string, sessionKey: string) =>
      ipcRenderer.invoke("agent:send", message, sessionKey) as Promise<{
        done: boolean;
        error?: string;
      }>,
    onStream: (callback: (chunk: string) => void) => {
      ipcRenderer.on("agent:stream-chunk", (_, chunk: string) =>
        callback(chunk),
      );
    },
  },
  startup: {
    onFailed: (callback: (detail: { message: string }) => void) => {
      const handler = (_: unknown, detail: { message: string }) =>
        callback(detail);
      ipcRenderer.on("startup:failed", handler);
      return () => ipcRenderer.removeListener("startup:failed", handler);
    },
    getDiagnostic: () =>
      ipcRenderer.invoke("startup:get-diagnostic") as Promise<Record<
        string,
        unknown
      > | null>,
    copyDiagnostic: () =>
      ipcRenderer.invoke("startup:copy-diagnostic") as Promise<{
        ok: boolean;
        message?: string;
      }>,
    openDataDir: () =>
      ipcRenderer.invoke("startup:open-data-dir") as Promise<{
        ok: boolean;
        message?: string;
      }>,
    getUpdateStatus: () =>
      ipcRenderer.invoke("startup:get-update-status") as Promise<{
        state: string;
        version?: string;
        releaseNotes?: string;
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
        message?: string;
      }>,
    checkUpdate: () =>
      ipcRenderer.invoke("startup:check-update") as Promise<{
        ok: boolean;
        message?: string;
      }>,
    quitAndInstall: () =>
      ipcRenderer.invoke("startup:quit-and-install") as Promise<{
        ok: boolean;
        message?: string;
      }>,
    retryGateway: () =>
      ipcRenderer.invoke("startup:retry-gateway") as Promise<{
        ok: boolean;
        message?: string;
      }>,
    onUpdateStatusChanged: (
      callback: (status: {
        state: string;
        version?: string;
        releaseNotes?: string;
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
        message?: string;
      }) => void,
    ) => {
      const handler = (_: unknown, status: Record<string, unknown>) =>
        callback(status as never);
      ipcRenderer.on("updater:status-changed", handler);
      return () =>
        ipcRenderer.removeListener("updater:status-changed", handler);
    },
  },
  gateway: {
    getCredential: () => ipcRenderer.invoke('gateway:get-credential') as Promise<string | undefined>,
    onExited: (
      callback: (detail: {
        code: number | null;
        signal: string | null;
      }) => void,
    ) => {
      const handler = (
        _: unknown,
        detail: { code: number | null; signal: string | null },
      ) => callback(detail);
      ipcRenderer.on("gateway:exited", handler);
      return () => ipcRenderer.removeListener("gateway:exited", handler);
    },
    restart: () =>
      ipcRenderer.invoke("gateway:restart") as Promise<{
        ok: boolean;
        message?: string;
        token?: string;
        port?: number;
      }>,
  },
  updater: {
    getStatus: () =>
      ipcRenderer.invoke("updater:get-status") as Promise<{
        state: string;
        version?: string;
        releaseNotes?: string;
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
        message?: string;
      }>,
    check: () =>
      ipcRenderer.invoke("updater:check") as Promise<{ ok: boolean }>,
    quitAndInstall: () =>
      ipcRenderer.invoke("updater:quit-and-install") as Promise<{
        ok: boolean;
      }>,
    onStatusChanged: (
      callback: (status: {
        state: string;
        version?: string;
        releaseNotes?: string;
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
        message?: string;
      }) => void,
    ) => {
      const handler = (_: unknown, status: Record<string, unknown>) =>
        callback(status as never);
      ipcRenderer.on("updater:status-changed", handler);
      return () =>
        ipcRenderer.removeListener("updater:status-changed", handler);
    },
  },
  platform: process.platform as "darwin" | "win32" | "linux",
  voiceInputHotkey: {
    onEvent: (callback: (action: "press" | "release") => void) => {
      const handler = (_: unknown, action: "press" | "release") => callback(action);
      ipcRenderer.on("voice-input:hotkey", handler);
      return () => ipcRenderer.removeListener("voice-input:hotkey", handler);
    },
  },
  menu: {
    getModel: () =>
      ipcRenderer.invoke("menu:get-model") as Promise<
        Array<{
          id: string;
          label: string;
          items: Array<
            | { type: "separator" }
            | {
                type: "item";
                id: string;
                label: string;
                accelerator?: string;
                role?: string;
              }
          >;
        }>
      >,
    invoke: (id: string) =>
      ipcRenderer.invoke("menu:invoke", id) as Promise<
        { ok: true } | { ok: false; error: "UNKNOWN_MENU_ACTION" }
      >,
    onNavigate: (callback: (path: string) => void) => {
      const handler = (_: unknown, path: string) => callback(path);
      ipcRenderer.on("menu:navigate", handler);
      return () => ipcRenderer.removeListener("menu:navigate", handler);
    },
    onTogglePalette: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("menu:toggle-palette", handler);
      return () => ipcRenderer.removeListener("menu:toggle-palette", handler);
    },
    onQuickCapture: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("menu:quick-capture", handler);
      return () => ipcRenderer.removeListener("menu:quick-capture", handler);
    },
    onToggleSidebar: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("menu:toggle-sidebar", handler);
      return () => ipcRenderer.removeListener("menu:toggle-sidebar", handler);
    },
    onHistoryNavigate: (callback: (delta: -1 | 1) => void) => {
      const handler = (_: unknown, delta: unknown) => {
        if (delta === -1 || delta === 1) callback(delta);
      };
      ipcRenderer.on("menu:history-navigate", handler);
      return () => ipcRenderer.removeListener("menu:history-navigate", handler);
    },
  },
  locale: {
    getLanguage: () =>
      ipcRenderer.invoke("electron-locale:get") as Promise<"en" | "zh">,
    setLanguage: (language: "en" | "zh") =>
      ipcRenderer.invoke("electron-locale:set", language) as Promise<{
        ok: true;
        language: "en" | "zh";
      }>,
    onChanged: (callback: (language: "en" | "zh") => void) => {
      const handler = (_: unknown, language: "en" | "zh") => callback(language);
      ipcRenderer.on("electron-locale:changed", handler);
      return () =>
        ipcRenderer.removeListener("electron-locale:changed", handler);
    },
  },
  cron: {
    setDisplaySleepPrevented: (enabled: boolean) =>
      ipcRenderer.invoke(
        "cron:set-prevent-display-sleep",
        enabled,
      ) as Promise<void>,
  },
  fullscreen: {
    enter: () => ipcRenderer.invoke("window:fullscreen-enter"),
    exit: () => ipcRenderer.invoke("window:fullscreen-exit"),
    toggle: () => ipcRenderer.invoke("window:fullscreen-toggle"),
    isFullscreen: () =>
      ipcRenderer.invoke("window:fullscreen-is") as Promise<boolean>,
    onChange: (callback: (isFullscreen: boolean) => void) => {
      const handler = (_: unknown, isFullscreen: boolean) =>
        callback(isFullscreen);
      ipcRenderer.on("window:fullscreen-changed", handler);
      return () =>
        ipcRenderer.removeListener("window:fullscreen-changed", handler);
    },
  },
  pet: {
    getState: () => ipcRenderer.invoke("desktop-pet:get-state"),
    setPrefs: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke("desktop-pet:set-prefs", patch),
    show: () => ipcRenderer.invoke("desktop-pet:show"),
    hide: () => ipcRenderer.invoke("desktop-pet:hide"),
    toggle: () => ipcRenderer.invoke("desktop-pet:toggle"),
    resetPosition: () => ipcRenderer.invoke("desktop-pet:reset-position"),
    openMainWindow: (path?: string) =>
      ipcRenderer.invoke("desktop-pet:open-main-window", path),
    setClickThrough: (enabled: boolean) =>
      ipcRenderer.invoke("desktop-pet:set-click-through", enabled),
    sendEvent: (event: Record<string, unknown>) =>
      ipcRenderer.invoke("desktop-pet:send-event", event),
    acknowledgeEvent: (sessionKey: string, runId: string) =>
      ipcRenderer.invoke("desktop-pet:ack-event", sessionKey, runId),
    openCustomPetsDir: () => ipcRenderer.invoke("desktop-pet:open-custom-dir"),
    createFromPrompt: (request: Record<string, unknown>) =>
      ipcRenderer.invoke("desktop-pet:create-from-prompt", request),
    startDrag: (point: { screenX: number; screenY: number }) =>
      ipcRenderer.invoke("desktop-pet:drag-start", point),
    drag: (point: { screenX: number; screenY: number }) =>
      ipcRenderer.invoke("desktop-pet:drag-move", point),
    endDrag: () => ipcRenderer.invoke("desktop-pet:drag-end"),
    setContentSize: (size: { width: number; height: number }) =>
      ipcRenderer.invoke("desktop-pet:set-content-size", size),
    onStateChanged: (callback: (state: Record<string, unknown>) => void) => {
      const handler = (_: unknown, state: Record<string, unknown>) =>
        callback(state);
      ipcRenderer.on("desktop-pet:state-changed", handler);
      return () =>
        ipcRenderer.removeListener("desktop-pet:state-changed", handler);
    },
    onEvent: (callback: (event: Record<string, unknown>) => void) => {
      const handler = (_: unknown, event: Record<string, unknown>) =>
        callback(event);
      ipcRenderer.on("desktop-pet:event", handler);
      return () => ipcRenderer.removeListener("desktop-pet:event", handler);
    },
  },
  system: {
    getBehavior: () => ipcRenderer.invoke("system-settings:get-behavior"),
    setBehavior: (patch: {
      openAtLogin?: boolean;
      openAsHidden?: boolean;
      keepAwakePreferred?: boolean;
      notifyEnabled?: boolean;
      notifySoundEnabled?: boolean;
    }) => ipcRenderer.invoke("system-settings:set-behavior", patch),
    getPermissions: (options?: { probe?: boolean }) =>
      ipcRenderer.invoke("system-settings:get-permissions", options),
    openPrivacy: (
      kind:
        | "fullDisk"
        | "screen"
        | "microphone"
        | "accessibility"
        | "automation"
        | "notifications"
        | "location"
        | "camera",
    ) => ipcRenderer.invoke("system-settings:open-privacy", kind),
    requestMicrophone: () =>
      ipcRenderer.invoke("system-settings:request-microphone"),
    requestAccessibility: () =>
      ipcRenderer.invoke("system-settings:request-accessibility"),
    requestNotifications: () =>
      ipcRenderer.invoke("system-settings:request-notifications"),
    requestScreen: () => ipcRenderer.invoke("system-settings:request-screen"),
    getUninstallInfo: () =>
      ipcRenderer.invoke("system-settings:get-uninstall-info"),
    clearUserData: () => ipcRenderer.invoke("system-settings:clear-user-data"),
    uninstallApp: (options?: { removeUserData?: boolean }) =>
      ipcRenderer.invoke("system-settings:uninstall-app", options),
  },
});

notifyPreload("preload:ready");

window.addEventListener("DOMContentLoaded", () => {
  notifyPreload("preload:dom-content-loaded");
});
