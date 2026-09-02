/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from '../copy-to-clipboard';

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for empty text', async () => {
    await expect(copyTextToClipboard('')).resolves.toBe(false);
  });

  it('uses navigator.clipboard.writeText when execCommand is unavailable', async () => {
    document.execCommand = undefined as unknown as typeof document.execCommand;

    await expect(copyTextToClipboard('https://example.com/s/abc')).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/s/abc');
  });

  it('falls back to copy event + execCommand when Clipboard API fails', async () => {
    document.execCommand = vi.fn().mockReturnValue(true);

    await expect(copyTextToClipboard('http://192.168.1.2:18790/s/token')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('falls back to the Electron bridge when the browser denies clipboard permission', async () => {
    document.execCommand = undefined as unknown as typeof document.execCommand;
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
      new DOMException('Write permission denied', 'NotAllowedError'),
    );
    const writeText = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { clipboard: { writeText } },
    });

    await expect(copyTextToClipboard('https://example.com/s/electron')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://example.com/s/electron');
  });
});
