import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { apiUrl } from '@/lib/url';
import { prepareHtmlPreviewDocument } from './html-preview-document';

export function HtmlPreviewFrame({ html, title }: { html: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const preparedHtml = useMemo(() => prepareHtmlPreviewDocument(html), [html]);
  const sendHtml = useCallback(() => {
    // The preview shell is sandboxed without allow-same-origin (opaque origin).
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'xopc-html-preview', html: preparedHtml },
      '*',
    );
  }, [preparedHtml]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow && event.data?.type === 'xopc-html-preview-ready') setReady(true);
    };
    window.addEventListener('message', onMessage);
    // Older gateway shells can render the preview without acknowledging it.
    const fallback = window.setTimeout(() => setReady(true), 1800);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(fallback);
    };
  }, []);

  useEffect(sendHtml, [sendHtml]);

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col" aria-busy={!ready}>
      {!ready ? <div className="pointer-events-none absolute inset-0 space-y-4 rounded-lg bg-surface-panel p-4">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-4 w-2/3" />
      </div> : null}
      <iframe
        ref={iframeRef}
        title={title}
        className={cn('min-h-0 w-full flex-1 rounded-lg border border-edge-subtle bg-white motion-safe:transition-opacity motion-safe:duration-150 dark:border-edge dark:bg-[#1e1e1e]',
          ready ? 'opacity-100' : 'pointer-events-none opacity-0')}
        tabIndex={ready ? undefined : -1}
        src={apiUrl('/api/preview/html')}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms allow-modals"
        referrerPolicy="no-referrer"
        onLoad={sendHtml}
      />
    </div>
  );
}
