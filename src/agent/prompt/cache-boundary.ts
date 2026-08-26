/**
 * Prompt cache boundary — splits the system prompt into a stable prefix (cacheable
 * by providers like Anthropic) and a dynamic suffix (changes per turn/session).
 *
 * xopc uses a system-prompt-cache-boundary pattern.
 */

export const PROMPT_CACHE_BOUNDARY = '\n<!-- XOPC_CACHE_BOUNDARY -->\n';

/**
 * Strip the cache boundary marker from a prompt string.
 */
export function stripPromptCacheBoundary(text: string): string {
  return text.replaceAll(PROMPT_CACHE_BOUNDARY, '\n');
}

/**
 * Split a system prompt at the cache boundary.
 * Returns undefined if no boundary is found.
 */
export function splitPromptCacheBoundary(
  text: string,
): { stablePrefix: string; dynamicSuffix: string } | undefined {
  const boundaryIndex = text.indexOf(PROMPT_CACHE_BOUNDARY);
  if (boundaryIndex === -1) {
    return undefined;
  }
  return {
    stablePrefix: text.slice(0, boundaryIndex).trimEnd(),
    dynamicSuffix: text.slice(boundaryIndex + PROMPT_CACHE_BOUNDARY.length).trimStart(),
  };
}

/**
 * Normalize a prompt section for cache stability.
 * Trims trailing whitespace per line, normalizes line endings, trims overall.
 */
export function normalizePromptSection(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/** Add stable content immediately before the cache boundary. */
export function appendStablePromptSection(systemPrompt: string, section: string): string {
  const normalizedSection = normalizePromptSection(section);
  if (!normalizedSection) return systemPrompt;

  const split = splitPromptCacheBoundary(systemPrompt);
  if (!split) {
    return [normalizePromptSection(systemPrompt), normalizedSection].filter(Boolean).join('\n\n');
  }

  const stablePrefix = [split.stablePrefix, normalizedSection].filter(Boolean).join('\n\n');
  return split.dynamicSuffix
    ? `${stablePrefix}${PROMPT_CACHE_BOUNDARY}${split.dynamicSuffix}`
    : `${stablePrefix}${PROMPT_CACHE_BOUNDARY}`;
}
