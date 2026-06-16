import { useCallback, useEffect, useRef, useState } from 'react';

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
};

type FsElement = Element & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

function getFullscreenElement(doc: Document): Element | null {
  const d = doc as FsDocument;
  return doc.fullscreenElement ?? d.webkitFullscreenElement ?? d.msFullscreenElement ?? null;
}

async function requestBrowserFullscreen(el: Element): Promise<void> {
  const anyEl = el as FsElement;
  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen();
      return;
    }
  } catch {
    /* fall through to prefixed APIs */
  }
  if (typeof anyEl.webkitRequestFullscreen === 'function') {
    await Promise.resolve(anyEl.webkitRequestFullscreen());
    return;
  }
  if (typeof anyEl.msRequestFullscreen === 'function') {
    await Promise.resolve(anyEl.msRequestFullscreen());
    return;
  }
  throw new Error('fullscreen_unavailable');
}

async function exitBrowserFullscreen(doc: Document): Promise<void> {
  const d = doc as FsDocument;
  if (typeof doc.exitFullscreen === 'function') {
    await doc.exitFullscreen();
    return;
  }
  if (typeof d.webkitExitFullscreen === 'function') {
    await Promise.resolve(d.webkitExitFullscreen());
    return;
  }
  if (typeof d.msExitFullscreen === 'function') {
    await Promise.resolve(d.msExitFullscreen());
  }
}

function isElectronFullscreenAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.fullscreen?.enter === 'function';
}

/**
 * Element fullscreen for the file preview pane (browser + Electron renderer).
 *
 * In the browser: uses the standard Fullscreen API on the DOM element.
 * In Electron: delegates to the main process via IPC (`BrowserWindow.setFullScreen`),
 * because Electron maps renderer `requestFullscreen()` to the whole window, not the element.
 */
export function useFilePreviewFullscreen() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const isElectron = isElectronFullscreenAvailable();

  /* ── Browser path ── */
  const syncBrowser = useCallback(() => {
    const root = rootRef.current;
    const cur = getFullscreenElement(document);
    setActive(Boolean(root && cur === root));
  }, []);

  useEffect(() => {
    if (isElectron) return;
    const onChange = () => syncBrowser();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [syncBrowser, isElectron]);

  /* ── Electron path ── */
  useEffect(() => {
    if (!isElectron) return;
    const api = window.electronAPI!.fullscreen!;
    const cleanup = api.onChange((fs) => setActive(fs));
    // initialise current state
    api.isFullscreen().then(setActive);
    return cleanup;
  }, [isElectron]);

  const enter = useCallback(async () => {
    if (isElectron) {
      await window.electronAPI!.fullscreen!.enter();
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    if (getFullscreenElement(document) === el) return;
    try {
      await requestBrowserFullscreen(el);
    } catch {
      /* unsupported or denied */
    }
  }, [isElectron]);

  const exit = useCallback(async () => {
    if (isElectron) {
      await window.electronAPI!.fullscreen!.exit();
      return;
    }
    if (getFullscreenElement(document) !== rootRef.current) return;
    try {
      await exitBrowserFullscreen(document);
    } catch {
      /* ignore */
    }
  }, [isElectron]);

  const toggle = useCallback(async () => {
    if (isElectron) {
      await window.electronAPI!.fullscreen!.toggle();
      return;
    }
    if (getFullscreenElement(document) === rootRef.current) {
      await exit();
    } else {
      await enter();
    }
  }, [isElectron, enter, exit]);

  return { rootRef, active, enter, exit, toggle };
}
