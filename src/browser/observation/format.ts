import type { BrowserNode, BrowserObservation } from '@xopcai/browser-control-contract';

export function formatBrowserObservation(observation: BrowserObservation): string {
  const lines = [
    `Session: ${observation.sessionId}`,
    `Tab: ${observation.tabId}`,
    `Revision: ${observation.revision}`,
    `URL: ${observation.url}`,
    `Title: ${observation.title}`,
  ];

  if (observation.nodes.length === 0) {
    lines.push('Interactive elements: none');
  } else {
    lines.push('Interactive elements:');
    for (const node of observation.nodes) lines.push(formatNode(node));
  }

  const { added, changed, removed } = observation.changes;
  if (added.length || changed.length || removed.length) {
    lines.push(`Changes: +${added.length} ~${changed.length} -${removed.length}`);
  }
  if (observation.visual) lines.push('Visual screenshot attached.');
  return lines.join('\n');
}

function formatNode(node: BrowserNode): string {
  const state = node.states.length ? ` [${node.states.join(',')}]` : '';
  const value = node.value ? ` value=${JSON.stringify(node.value)}` : '';
  return `- ${node.ref} ${node.role} ${JSON.stringify(node.name)}${value}${state}`;
}
