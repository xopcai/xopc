/**
 * ACP Metadata Helpers
 */

/**
 * Read a boolean value from metadata
 */
export function readBool(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return defaultValue;
}

/**
 * Read a number from metadata
 */
export function readNumber(value: unknown, defaultValue = 0): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

/**
 * Read a string from metadata
 */
export function readString(value: unknown, defaultValue = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return String(value);
}
