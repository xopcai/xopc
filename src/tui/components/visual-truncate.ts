import { Text } from '@earendil-works/pi-tui';

export interface VisualTruncateResult {
  visualLines: string[];
  skippedCount: number;
}

/**
 * Truncate text by rendered terminal rows, not source lines.
 *
 * This keeps collapsed previews bounded when one very long logical line wraps
 * across many terminal rows.
 */
export function truncateToVisualLines(
  text: string,
  maxVisualLines: number,
  width: number,
  paddingX = 0,
): VisualTruncateResult {
  if (!text || maxVisualLines <= 0) {
    return { visualLines: [], skippedCount: 0 };
  }

  const rendered = new Text(text, paddingX, 0).render(width);
  if (rendered.length <= maxVisualLines) {
    return { visualLines: rendered, skippedCount: 0 };
  }

  return {
    visualLines: rendered.slice(-maxVisualLines),
    skippedCount: rendered.length - maxVisualLines,
  };
}
