import { ResourceUnavailable } from '@/components/ui/resource-unavailable';
/**
 * ExtensionPage — renders a full-page extension UI via ExtensionIframeHost.
 *
 * Mounted at /extensions/:extensionId (or /extensions/:extensionId/:pageId for multi-page extensions).
 */

import { useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';

import { usePageHeaderStore } from '@/stores/page-header-store';

import { ExtensionIframeHost } from './extension-iframe-host';
import { useExtensions } from './extension-provider';
import { extensionShellUiReachable } from './extension-ui-guards';

export function ExtensionPage() {
  const { extensionId, pageId } = useParams<{ extensionId: string; pageId?: string }>();
  const extensions = useExtensions();
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const extension = extensionId
    ? extensions.find((ext) => ext.id === extensionId && extensionShellUiReachable(ext))
    : undefined;
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
    return <ResourceUnavailable kind="plugin" backTo="/capabilities/extensions" />;
  }

  if (!extension) {
    return (
      <ResourceUnavailable kind={extensions.some(ext => ext.id === extensionId) ? "plugin-page" : "plugin"} backTo="/capabilities/extensions" />
    );
  }

  if (!pages?.length) {
    return (
      <ResourceUnavailable kind="plugin-page" backTo="/capabilities/extensions" />
    );
  }

  if (!page) {
    return (
      <ResourceUnavailable kind="plugin" backTo="/capabilities/extensions" />
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
