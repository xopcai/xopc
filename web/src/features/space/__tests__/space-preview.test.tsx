// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { SpaceVersion } from '@xopcai/gateway-contract';
import { expect, it, vi } from 'vitest';

import { prepareHtmlPreviewDocument } from '@/features/preview-runtime/html-preview-document';

import { spaceContent } from '../space-api';
import { SpacePreview } from '../space-preview';

vi.mock('../space-api', () => ({ spaceContent: vi.fn() }));

it('renders archived HTML in the isolated preview even for a search hit', async () => {
  const html = '<!doctype html><h1>Daily report</h1>';
  const version: SpaceVersion = {
    id: 'version-1', ordinal: 1, fileName: 'report.html', mimeType: 'application/octet-stream',
    sizeBytes: html.length, createdAt: 0, indexStatus: 'ready',
  };
  vi.mocked(spaceContent).mockResolvedValue(new Blob([html], { type: version.mimeType }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

  try {
    await act(async () => root.render(<SpacePreview itemId="item-1" version={version}
      hit={{ text: 'Daily report', locator: { line: 1 } }} download={vi.fn()} />));

    expect(spaceContent).toHaveBeenCalledWith('item-1', version.id, expect.any(AbortSignal));
    expect(container.querySelector('pre, [data-line]')).toBeNull();
    const frame = container.querySelector<HTMLIFrameElement>('iframe[title="report.html"]')!;
    expect(frame.src).toBe(`${window.location.origin}/api/preview/html`);
    expect(frame.getAttribute('sandbox')?.split(' ')).not.toContain('allow-same-origin');
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    act(() => frame.dispatchEvent(new Event('load')));
    expect(postMessage).toHaveBeenCalledWith({ type: 'xopc-html-preview', html: prepareHtmlPreviewDocument(html) }, '*');
  } finally {
    act(() => root.unmount());
    container.remove();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    vi.restoreAllMocks();
  }
});
