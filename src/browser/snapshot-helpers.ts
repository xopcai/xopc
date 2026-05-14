/**
 * Snapshot intelligence helpers — structure-aware truncation for ARIA snapshots.
 *
 * ARIA snapshots use indentation-based YAML-like trees. Naive character-based
 * truncation can split in the middle of a node, making the output confusing.
 * These helpers preserve tree-node boundaries and provide metadata.
 */

/**
 * Truncate an ARIA snapshot at a line boundary, preserving complete tree nodes.
 *
 * Strategy:
 * 1. If the text is within `maxLength`, return as-is.
 * 2. Find the last newline before `maxLength`.
 * 3. Walk backwards to find a line at indentation level ≤ 2 (top-level nodes),
 *    ensuring we don't cut inside a deeply nested subtree.
 * 4. Append a truncation notice with stats.
 */
export function truncateSnapshotAtBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  // Find the last newline before the limit
  let cutoff = text.lastIndexOf('\n', maxLength);
  if (cutoff <= 0) {
    // No newline found — fall back to hard cut
    return `${text.slice(0, maxLength)}\n... (truncated)`;
  }

  // Try to cut at a top-level node boundary (indent ≤ 2 spaces)
  // by walking backwards up to 2000 chars to find a clean cut point.
  const searchStart = Math.max(0, cutoff - 2000);
  const lines = text.slice(searchStart, cutoff).split('\n');

  let bestCutIndex = cutoff;
  let accumulated = cutoff;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const indent = line.search(/\S/);
    // A line with indent ≤ 2 or an empty line marks a clean boundary
    if (indent >= 0 && indent <= 2) {
      bestCutIndex = accumulated;
      break;
    }
    accumulated -= line.length + 1; // +1 for newline
  }

  const truncated = text.slice(0, bestCutIndex);
  const totalLines = text.split('\n').length;
  const shownLines = truncated.split('\n').length;
  const omittedLines = totalLines - shownLines;

  return `${truncated}\n... (truncated: showing ${shownLines} of ${totalLines} lines, ${omittedLines} lines omitted)`;
}

/**
 * Produce a compact summary header for a snapshot.
 * Counts interactive elements (links, buttons, inputs) to help the agent
 * understand page complexity at a glance.
 */
export function snapshotSummaryHeader(snapshotText: string, pageUrl: string): string {
  const lines = snapshotText.split('\n');
  const totalLines = lines.length;

  let linkCount = 0;
  let buttonCount = 0;
  let inputCount = 0;
  let imageCount = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('- link ') || trimmed.startsWith('- link:')) linkCount++;
    if (trimmed.startsWith('- button ') || trimmed.startsWith('- button:')) buttonCount++;
    if (trimmed.startsWith('- textbox ') || trimmed.startsWith('- textbox:') ||
        trimmed.startsWith('- searchbox ') || trimmed.startsWith('- combobox ')) inputCount++;
    if (trimmed.startsWith('- img ') || trimmed.startsWith('- img:')) imageCount++;
  }

  const parts = [`Page: ${pageUrl}`, `Snapshot: ${totalLines} lines`];
  const counts: string[] = [];
  if (linkCount > 0) counts.push(`${linkCount} links`);
  if (buttonCount > 0) counts.push(`${buttonCount} buttons`);
  if (inputCount > 0) counts.push(`${inputCount} inputs`);
  if (imageCount > 0) counts.push(`${imageCount} images`);
  if (counts.length > 0) {
    parts.push(`Interactive: ${counts.join(', ')}`);
  }

  return parts.join(' | ');
}
