import type { BrowserObservation } from '@xopcai/browser-control-contract';

import type { AgentSourceContext } from './types.js';

const MAX_BROWSER_CONTEXT_CHARS = 96_000;

export function buildBrowserTabAgentContext(
  sourceId: string,
  observation: BrowserObservation,
  expectedVersion?: string,
): AgentSourceContext | null {
  if (expectedVersion && expectedVersion !== observation.documentId) return null;
  const snapshot = JSON.stringify({
    title: observation.title,
    url: observation.url,
    interactiveElements: observation.nodes.map(({ role, name, value, description, states }) => ({
      role, name, value, description, states,
    })),
  }, null, 2);
  const text = snapshot.slice(0, MAX_BROWSER_CONTEXT_CHARS);
  return {
    kind: 'browser_tab',
    sourceId,
    version: observation.documentId,
    title: observation.title || observation.url,
    url: observation.url,
    documentId: observation.documentId,
    text,
    truncated: text.length < snapshot.length,
  };
}
