/**
 * Frontmatter parsing utility
 * Extracts YAML frontmatter from markdown content
 */

export interface ParsedFrontmatter<T = Record<string, unknown>> {
  frontmatter: T;
  content: string;
}

/**
 * Parse YAML frontmatter from markdown content
 * Supports both JSON and YAML-style frontmatter
 */
export function parseFrontmatter<T = Record<string, unknown>>(
  content: string
): ParsedFrontmatter<T> {
  // Match --- frontmatter ---
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (!frontmatterMatch) {
    return {
      frontmatter: {} as T,
      content: content.trim(),
    };
  }

  const [, frontmatterRaw, bodyContent] = frontmatterMatch;

  // Try to parse as JSON first (if wrapped in {})
  let frontmatter: Record<string, unknown> = {};
  
  try {
    const trimmed = frontmatterRaw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      frontmatter = JSON.parse(trimmed);
    } else {
      // Simple YAML-like parsing for key: value pairs
      frontmatter = parseSimpleYaml(trimmed);
    }
  } catch {
    // If parsing fails, treat as empty
    frontmatter = {};
  }

  return {
    frontmatter: frontmatter as T,
    content: bodyContent.trim(),
  };
}

/**
 * Simple YAML parser for key: value pairs
 * Handles:
 * - key: value
 * - key: "quoted value"
 * - key: 'quoted value'
 * - key: { json: object }
 * - key: [array, values]
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    // Remove quotes
    if (typeof value === 'string') {
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Try to parse as JSON (for objects/arrays)
      const strValue = value as string;
      if ((strValue.startsWith('{') && strValue.endsWith('}')) ||
          (strValue.startsWith('[') && strValue.endsWith(']'))) {
        try {
          value = JSON.parse(strValue);
        } catch {
          // Keep as string if JSON parsing fails
        }
      }

      // Try to parse as number
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
        value = parseFloat(value);
      }

      // Parse booleans
      if (value === 'true') value = true;
      if (value === 'false') value = false;
    }

    result[key] = value;
  }

  return result;
}

/**
 * Serialize frontmatter to YAML format
 */
export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (typeof value === 'string' && (value.includes(':') || value.includes('\n'))) {
      return `${key}: "${value.replace(/"/g, '\\"')}"`;
    }
    if (typeof value === 'object') {
      return `${key}: ${JSON.stringify(value)}`;
    }
    return `${key}: ${value}`;
  });

  return `---\n${lines.join('\n')}\n---`;
}
