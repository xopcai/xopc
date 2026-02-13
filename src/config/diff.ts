/**
 * Configuration diff utilities
 */

/**
 * Check if value is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Deep compare two values and return list of changed paths
 */
export function diffConfigPaths(prev: unknown, next: unknown, prefix = ''): string[] {
  if (prev === next) {
    return [];
  }

  // Both are plain objects - recurse
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    const paths: string[] = [];

    for (const key of keys) {
      const prevValue = (prev as Record<string, unknown>)[key];
      const nextValue = (next as Record<string, unknown>)[key];
      if (prevValue === nextValue) {
        continue;
      }
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      const childPaths = diffConfigPaths(prevValue, nextValue, childPrefix);
      paths.push(...childPaths);
    }

    return paths;
  }

  // Both are arrays - simple comparison
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length === next.length && prev.every((val, idx) => val === next[idx])) {
      return [];
    }
    return [prefix || '<root>'];
  }

  // Primitive or other types changed
  return [prefix || '<root>'];
}
