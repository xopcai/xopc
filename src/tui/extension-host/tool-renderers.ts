import type {
  TuiToolRenderContext,
  TuiToolRenderer,
} from '../../extensions/types/tui.js';

const renderers = new Map<string, TuiToolRenderer>();

export function registerTuiToolRenderer(toolName: string, renderer: TuiToolRenderer): () => void {
  renderers.set(toolName, renderer);
  return () => {
    if (renderers.get(toolName) === renderer) {
      renderers.delete(toolName);
    }
  };
}

export function renderToolWithExtensions(ctx: TuiToolRenderContext): string[] | null {
  const renderer = renderers.get(ctx.toolName);
  if (!renderer) return null;
  return renderer(ctx);
}

export function clearTuiToolRenderers(): void {
  renderers.clear();
}

/** Test helper */
export function getTuiToolRendererCount(): number {
  return renderers.size;
}
