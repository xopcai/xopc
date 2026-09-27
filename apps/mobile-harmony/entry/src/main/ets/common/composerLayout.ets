// Keep logical sizes aligned with mobile-expo's composer-layout and ChatComposer.
export const COMPOSER_INPUT_MIN: number = 40;
export const COMPOSER_INPUT_MAX: number = 120;
export const COMPOSER_TOOL_SIZE: number = 36;

export function composerExpanded(text: string, files: number, refs: number, palette: boolean): boolean {
  return text.length > 0 || files > 0 || refs > 0 || palette;
}

export function composerHasPayload(text: string, files: number, refs: number): boolean {
  return text.trim().length > 0 || files > 0 || refs > 0;
}
