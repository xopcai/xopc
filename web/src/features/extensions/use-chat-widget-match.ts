/**
 * useChatWidgetMatch — finds a registered chat widget that matches a given tool name.
 */

import { useMemo } from 'react';

import { useUiExtensions } from './extension-provider';
import type { ChatWidgetContribution } from './types';

export interface ChatWidgetMatch extends ChatWidgetContribution {
  extensionId: string;
}

export function useChatWidgetMatch(toolName: string): ChatWidgetMatch | null {
  const uiExtensions = useUiExtensions();

  return useMemo(() => {
    for (const extension of uiExtensions) {
      const widgets = extension.ui?.contributions?.chatWidgets;
      if (!widgets) continue;

      for (const widget of widgets) {
        if (widget.match.toolName && widget.match.toolName === toolName) {
          return { ...widget, extensionId: extension.id };
        }
      }
    }
    return null;
  }, [uiExtensions, toolName]);
}
