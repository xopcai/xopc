/**
 * ExtensionPage — renders a full-page extension UI via ExtensionIframeHost.
 *
 * Mounted at /apps/:extensionId (or /apps/:extensionId/:pageId for multi-page extensions).
 */

import { useParams } from 'react-router-dom';

import { ExtensionIframeHost } from './extension-iframe-host';
import { useUiExtensions } from './extension-provider';

export function ExtensionPage() {
  const { extensionId, pageId } = useParams<{ extensionId: string; pageId?: string }>();
  const uiExtensions = useUiExtensions();

  if (!extensionId) {
    return <ExtensionPageNotFound message="No extension ID provided." />;
  }

  const extension = uiExtensions.find((ext) => ext.id === extensionId);
  if (!extension) {
    return (
      <ExtensionPageNotFound message={`Extension "${extensionId}" not found or has no UI.`} />
    );
  }

  const pages = extension.ui?.contributions?.pages;
  if (!pages?.length) {
    return (
      <ExtensionPageNotFound message={`Extension "${extensionId}" has no page contributions.`} />
    );
  }

  const page = pageId
    ? pages.find((p) => p.id === pageId || p.id === `${extensionId}.${pageId}`)
    : pages[0];

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
