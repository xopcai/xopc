export type ComputerPreviewSize = { width: number; height: number };

export const COMPUTER_PREVIEW_MAX_HEIGHT = 'min(36dvh, 320px)';

export function computerPreviewRatio(size?: ComputerPreviewSize): number | undefined {
  return size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    ? size.width / size.height : undefined;
}

export function computerPreviewWidth(size?: ComputerPreviewSize): string {
  const ratio = computerPreviewRatio(size);
  // Fit the projection itself; no surrounding chrome or minimum control width.
  return ratio ? `min(calc(100vw - 2rem), ${36 * ratio}dvh, ${Math.min(480, 320 * ratio)}px)`
    : 'min(320px, calc(100vw - 2rem))';
}
