/**
 * Writes text to the system clipboard.
 * In Electron, uses main-process `clipboard.writeText` (reliable on embedded `file://` and gateway URLs).
 * Otherwise tries synchronous `execCommand('copy')` first so copies from button clicks stay
 * within the user-activation window (Safari / some WebViews reject async Clipboard API).
 * Falls back to `navigator.clipboard.writeText` when the legacy path fails.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    const electronWrite =
      typeof window !== 'undefined' ? window.electronAPI?.clipboard?.writeText : undefined;
    if (electronWrite) {
      return await electronWrite(text);
    }
  } catch {
    /* fall through to renderer strategies */
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return true;
  } catch {
    /* try Clipboard API below */
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
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
