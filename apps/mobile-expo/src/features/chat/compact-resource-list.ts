export const COMPACT_RESOURCE_PREVIEW_COUNT = 3;

export function compactResourcePreview<T>(items: T[]): {
  visible: T[];
  hiddenCount: number;
} {
  return {
    visible: items.slice(0, COMPACT_RESOURCE_PREVIEW_COUNT),
    hiddenCount: Math.max(0, items.length - COMPACT_RESOURCE_PREVIEW_COUNT),
  };
}
