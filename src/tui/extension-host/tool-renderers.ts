import type {
  TuiTheme,
  TuiToolRenderContext,
  TuiToolRendererDefinition,
  TuiToolRendererRegistration,
  TuiToolRendererResult,
} from '../../extensions/types/tui.js';

const renderers = new Map<string, TuiToolRendererDefinition>();

function normalizeRenderer(renderer: TuiToolRendererRegistration): TuiToolRendererDefinition {
  if (typeof renderer === 'function') return { render: renderer };
  return renderer;
}

export function registerTuiToolRenderer(
  toolName: string,
  renderer: TuiToolRendererRegistration,
): () => void {
  const definition = normalizeRenderer(renderer);
  renderers.set(toolName, definition);
  return () => {
    if (renderers.get(toolName) === definition) {
      renderers.delete(toolName);
    }
  };
}

export function renderToolWithExtensions(ctx: TuiToolRenderContext): TuiToolRendererResult {
  const renderer = renderers.get(ctx.toolName)?.render;
  if (!renderer) return null;
  try {
    return renderer(ctx);
  } catch {
    return null;
  }
}

export function renderToolCallWithExtensions(
  ctx: TuiToolRenderContext,
  theme: TuiTheme,
): TuiToolRendererResult {
  const renderer = renderers.get(ctx.toolName)?.renderCall;
  if (!renderer) return null;
  try {
    return renderer(ctx.args, theme, ctx);
  } catch {
    return null;
  }
}

export function renderToolResultWithExtensions(
  ctx: TuiToolRenderContext,
  theme: TuiTheme,
): TuiToolRendererResult {
  const renderer = renderers.get(ctx.toolName)?.renderResult;
  if (!renderer) return null;
  try {
    return renderer(
      {
        content: ctx.content,
        details: ctx.details,
        text: ctx.resultText,
      },
      {
        expanded: ctx.expanded,
        isPartial: ctx.isPartial === true,
      },
      theme,
      ctx,
    );
  } catch {
    return null;
  }
}

export function hasStructuredTuiToolRenderer(toolName: string): boolean {
  const definition = renderers.get(toolName);
  return Boolean(definition?.renderCall || definition?.renderResult);
}

export function clearTuiToolRenderers(): void {
  renderers.clear();
}

/** Test helper */
export function getTuiToolRendererCount(): number {
  return renderers.size;
}
