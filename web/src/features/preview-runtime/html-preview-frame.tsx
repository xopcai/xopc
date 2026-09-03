import { useCallback, useEffect, useRef } from 'react';

import { apiUrl } from '@/lib/url';

export function HtmlPreviewFrame({ html, title }: { html: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sendHtml = useCallback(() => {
    // The preview shell is sandboxed without allow-same-origin (opaque origin).
    iframeRef.current?.contentWindow?.postMessage({ type: 'xopc-html-preview', html }, '*');
  }, [html]);

  useEffect(sendHtml, [sendHtml]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      className="min-h-0 w-full flex-1 rounded-lg border border-edge-subtle bg-white dark:border-edge dark:bg-[#1e1e1e]"
      src={apiUrl('/api/preview/html')}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms allow-modals"
      referrerPolicy="no-referrer"
      onLoad={sendHtml}
    />
  );
}
