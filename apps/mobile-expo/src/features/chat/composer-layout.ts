export const MAX_COMPOSER_INPUT_HEIGHT = 120;
export const MIN_COMPOSER_INPUT_HEIGHT = 36;
export const COMPOSER_INPUT_LINE_HEIGHT = 20;

const DEFAULT_COMPOSER_INPUT_WIDTH = 320;
const COMPOSER_INPUT_HORIZONTAL_PADDING = 32;
const ESTIMATED_CJK_CHAR_WIDTH = 15;
const ESTIMATED_ASCII_CHAR_WIDTH = 7.5;
const INPUT_VERTICAL_PADDING = 10;

export function clampComposerInputHeight(height: number): number {
  return Math.min(Math.max(height, MIN_COMPOSER_INPUT_HEIGHT), MAX_COMPOSER_INPUT_HEIGHT);
}

function estimateLineUnits(text: string): number {
  return Array.from(text).reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.4;
    if (character.charCodeAt(0) > 255) return total + 1;
    return total + ESTIMATED_ASCII_CHAR_WIDTH / ESTIMATED_CJK_CHAR_WIDTH;
  }, 0);
}

export function estimateComposerInputHeight(text: string, availableWidth = DEFAULT_COMPOSER_INPUT_WIDTH): number {
  const usableWidth = Math.max(availableWidth - COMPOSER_INPUT_HORIZONTAL_PADDING, ESTIMATED_CJK_CHAR_WIDTH * 8);
  const unitsPerLine = Math.max(Math.floor(usableWidth / ESTIMATED_CJK_CHAR_WIDTH), 8);
  const visualLineCount = text.split('\n').reduce((lineCount, paragraph) => {
    const paragraphLineCount = Math.max(1, Math.ceil(estimateLineUnits(paragraph) / unitsPerLine));
    return lineCount + paragraphLineCount;
  }, 0);

  return clampComposerInputHeight(
    visualLineCount * COMPOSER_INPUT_LINE_HEIGHT + INPUT_VERTICAL_PADDING,
  );
}
