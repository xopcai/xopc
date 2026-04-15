/**
 * ExtensionChatWidget — extension chat widget iframe in the message stream.
 */

import { ExtensionIframeHost } from './extension-iframe-host';

type ExtensionChatWidgetProps = {
  extensionId: string;
  widgetId: string;
  entrypoint: string;
  title: string;
  toolResult: unknown;
  maxHeight?: number;
  interactive?: boolean;
  permissions?: string[];
};

export function ExtensionChatWidget({
  extensionId,
  widgetId: _widgetId,
  entrypoint,
  title,
  toolResult,
  maxHeight = 400,
  interactive: _interactive = false,
  permissions,
}: ExtensionChatWidgetProps) {
  return (
    <div className="mt-2 w-full min-w-0 overflow-hidden rounded-xl border border-edge bg-surface-base">
      <ExtensionIframeHost
        extensionId={extensionId}
        entrypoint={entrypoint}
        permissions={permissions}
        title={title}
        className="w-full"
        minHeight={80}
        maxHeight={maxHeight}
        initialData={toolResult}
      />
    </div>
  );
}
