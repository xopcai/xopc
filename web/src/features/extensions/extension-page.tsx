/**
 * ExtensionPage — renders a full-page extension UI via ExtensionIframeHost.
 *
 * Mounted at /apps/:extensionId (or /apps/:extensionId/:pageId for multi-page extensions).
 */

import { useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';

import { usePageHeaderStore } from '@/stores/page-header-store';

import { ExtensionIframeHost } from './extension-iframe-host';
import { useUiExtensions } from './extension-provider';

export function ExtensionPage() {
  const { extensionId, pageId } = useParams<{ extensionId: string; pageId?: string }>();
  const uiExtensions = useUiExtensions();
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const extension = extensionId ? uiExtensions.find((ext) => ext.id === extensionId) : undefined;
  const pages = extension?.ui?.contributions?.pages;
  const page =
    extensionId && pages?.length
      ? pageId
        ? pages.find((p) => p.id === pageId || p.id === `${extensionId}.${pageId}`)
        : pages[0]
      : undefined;

  useLayoutEffect(() => {
    if (!extensionId || !extension || !page) {
      clearPageHeader();
      return () => clearPageHeader();
    }
    const headline = page.title?.trim() || extension.name || extensionId;
    setPageHeader({
      startExtra: null,
      main: (
        <div className="w-full min-w-0 px-3 sm:px-5 xl:px-6">
          <h1
            className="min-w-0 truncate text-base font-semibold tracking-tight text-fg"
            title={headline}
          >
            {headline}
          </h1>
        </div>
      ),
      end: null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, extension, extensionId, page, setPageHeader]);

  if (!extensionId) {
    return <ExtensionPageNotFound message="No extension ID provided." />;
  }

  if (!extension) {
    return (
      <ExtensionPageNotFound message={`Extension "${extensionId}" not found or has no UI.`} />
    );
  }

  if (!pages?.length) {
    return (
      <ExtensionPageNotFound message={`Extension "${extensionId}" has no page contributions.`} />
    );
  }

  if (!page) {
    return (
      <ExtensionPageNotFound message={`Page "${pageId}" not found in extension "${extensionId}".`} />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ExtensionIframeHost
        extensionId={extensionId}
        extensionName={extension.name}
        entrypoint={page.entrypoint}
        permissions={extension.ui?.permissions}
        title={page.title}
        className="min-h-0 flex-1"
        fixedHeight={undefined}
        maxHeight={99999}
      />
    </div>
  );
}

function ExtensionPageNotFound({ message }: { message: string }) {
  return (
    <div className="flex min-h-[min(40vh,16rem)] flex-1 items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-fg-muted">{message}</p>
      </div>
    </div>
  );
}
