import { html, type TemplateResult } from 'lit';
import './renderers/register-builtins.js';
import './artifacts/index.js';
import { DefaultRenderer } from './renderers/DefaultRenderer.js';
import { getToolRenderer } from './renderer-registry.js';
import type { ToolRenderResult, ToolResultMessage } from './types.js';

export type { ToolRenderer, ToolRenderResult, ToolResultMessage, ToolContentPart } from './types.js';
export {
  registerToolRenderer,
  getToolRenderer,
  toolRenderers,
  renderHeader,
  renderCollapsibleHeader,
} from './renderer-registry.js';
export { stringToToolResultMessage, extractTextFromToolResult } from './result-adapter.js';
export { DefaultRenderer } from './renderers/DefaultRenderer.js';
export { BashRenderer } from './renderers/BashRenderer.js';

const defaultRenderer = new DefaultRenderer();

let showJsonMode = false;

export function setShowJsonMode(enabled: boolean): void {
  showJsonMode = enabled;
}

/**
 * Render tool — same contract as pi-mono web-ui `tools/index.ts`.
 */
export function renderTool(
  toolName: string,
  params: unknown | undefined,
  result: ToolResultMessage | undefined,
  isStreaming?: boolean,
): ToolRenderResult {
  if (showJsonMode) {
    return defaultRenderer.render(params, result, isStreaming);
  }
  const renderer = getToolRenderer(toolName);
  if (renderer) {
    return renderer.render(params, result, isStreaming);
  }
  return defaultRenderer.render(params, result, isStreaming);
}

export function renderToolToHtml(
  toolName: string,
  params: unknown | undefined,
  result: ToolResultMessage | undefined,
  isStreaming: boolean,
): TemplateResult {
  const { content, isCustom } = renderTool(toolName, params, result, isStreaming);
  if (isCustom) {
    return content;
  }
  return html`<div class="tool-call-card rounded-lg p-3 border border-border bg-surface">${content}</div>`;
}
