// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HtmlPreviewFrame } from '../html-preview-frame';

describe('HTML preview frame', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('loads the isolated shell and sends HTML after load and on edits', () => {
    const originalHtml = '<script>document.body.textContent = "ready"</script>';
    act(() => root.render(<HtmlPreviewFrame html={originalHtml} title="report.html" />));
    const frame = container.querySelector('iframe')!;
    expect(frame.src).toBe(`${window.location.origin}/api/preview/html`);
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');

    act(() => frame.dispatchEvent(new Event('load')));
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'xopc-html-preview', html: originalHtml }, '*');

    const editedHtml = '<button onclick="this.textContent = 2">1</button>';
    act(() => root.render(<HtmlPreviewFrame html={editedHtml} title="report.html" />));
    expect(container.querySelector('iframe')).toBe(frame);
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'xopc-html-preview', html: editedHtml }, '*');

    // A late shell load must receive the current file, even after a prior update.
    act(() => frame.dispatchEvent(new Event('load')));
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'xopc-html-preview', html: editedHtml }, '*');
  });
});
