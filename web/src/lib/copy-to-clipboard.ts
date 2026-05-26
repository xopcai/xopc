/**
 * Writes text to the system clipboard.
 * In Electron, uses main-process `clipboard.writeText` (reliable on embedded `file://` and gateway URLs).
 * In secure browser contexts, prefers `navigator.clipboard.writeText`.
 * Otherwise uses a `copy` event listener + `execCommand('copy')`, then a textarea fallback.
 */

function copyTextViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;

  try {
    const onCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    const ok = document.execCommand('copy');
    document.removeEventListener('copy', onCopy);
    if (ok) return true;
  } catch {
    /* try textarea fallback below */
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // Sync first so button clicks keep the user-gesture window (HTTP LAN, Safari, etc.).
  if (copyTextViaExecCommand(text)) return true;

  if (typeof navigator !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }

  try {
    const electronWrite =
      typeof window !== 'undefined' ? window.electronAPI?.clipboard?.writeText : undefined;
    if (electronWrite) {
      const ok = await electronWrite(text);
      if (ok) return true;
    }
  } catch {
    /* exhausted */
  }

  return false;
}

/** Focus and select all text in a readonly input/textarea (manual copy fallback). */
export function selectInputText(element: HTMLInputElement | HTMLTextAreaElement | null | undefined): void {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.select();
  if (typeof element.setSelectionRange === 'function') {
    element.setSelectionRange(0, element.value.length);
  }
}

/** Reads plain text from the system clipboard (Electron main process when available). */
export async function readTextFromClipboard(): Promise<string | null> {
  try {
    const electronRead =
      typeof window !== 'undefined' ? window.electronAPI?.clipboard?.readText : undefined;
    if (electronRead) {
      return await electronRead();
    }
  } catch {
    /* fall through */
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    return null;
  }
  return null;
}
