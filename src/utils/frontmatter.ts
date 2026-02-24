/**
 * Frontmatter parsing utility
 * Extracts YAML frontmatter from markdown content
 */

import yaml from 'js-yaml';

export interface ParsedFrontmatter<T = Record<string, unknown>> {
  frontmatter: T;
  content: string;
}

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter<T = Record<string, unknown>>(
  content: string
): ParsedFrontmatter<T> {
  // Match --- frontmatter --- (supports both Unix \n and Windows \r\n line endings)
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  
  if (!frontmatterMatch) {
    return {
      frontmatter: {} as T,
      content: content.trim(),
    };
  }

  const [, frontmatterRaw, bodyContent] = frontmatterMatch;

  try {
    const frontmatter = yaml.load(frontmatterRaw) as Record<string, unknown>;
    return {
      frontmatter: (frontmatter || {}) as T,
      content: bodyContent.trim(),
    };
  } catch (error) {
    console.warn('Failed to parse frontmatter:', error);
    return {
      frontmatter: {} as T,
      content: bodyContent.trim(),
    };
  }
}

/**
 * Serialize frontmatter to YAML format
 */
export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  return '---\n' + yaml.dump(frontmatter) + '---';
}
