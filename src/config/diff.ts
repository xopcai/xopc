/**
 * Configuration diff utilities
 */

/**
 * Check if value is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
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

  // Both are arrays — compare element by element. We recurse so that two
  // equal-by-value arrays whose elements are differently-allocated objects
  // (e.g. from two separate `ConfigSchema.parse` passes) don't report a
  // false-positive diff. Bail out at the parent path on length mismatch.
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) {
      return [prefix || '<root>'];
    }
    for (let i = 0; i < prev.length; i++) {
      if (diffConfigPaths(prev[i], next[i], prefix).length > 0) {
        return [prefix || '<root>'];
      }
    }
    return [];
  }

  // Primitive or other types changed
  return [prefix || '<root>'];
}
