/**
 * Writes text to the system clipboard.
 * Tries synchronous `execCommand('copy')` first so copies from button clicks stay
 * within the user-activation window (Safari / some WebViews reject async Clipboard API).
 * Falls back to `navigator.clipboard.writeText` when the legacy path fails.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

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
