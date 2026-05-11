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

async function requestFullscreen(el: Element): Promise<void> {
  const anyEl = el as FsElement;
  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
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

async function exitFullscreen(doc: Document): Promise<void> {
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

/**
 * Element fullscreen for the file preview pane (browser + Electron renderer).
 * Uses the standard top layer so content is not clipped by dialog `overflow: hidden`.
 */
export function useFilePreviewFullscreen() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  const sync = useCallback(() => {
    const root = rootRef.current;
    const cur = getFullscreenElement(document);
    setActive(Boolean(root && cur === root));
  }, []);

  useEffect(() => {
    const onChange = () => sync();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [sync]);

  const enter = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    if (getFullscreenElement(document) === el) return;
    try {
      await requestFullscreen(el);
    } catch {
      /* unsupported or denied */
    }
  }, []);

  const exit = useCallback(async () => {
    if (getFullscreenElement(document) !== rootRef.current) return;
    try {
      await exitFullscreen(document);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(async () => {
    if (getFullscreenElement(document) === rootRef.current) {
      await exit();
    } else {
      await enter();
    }
  }, [enter, exit]);

  return { rootRef, active, enter, exit, toggle };
}
