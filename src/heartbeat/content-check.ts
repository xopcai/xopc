/**
 * True when HEARTBEAT.md has no actionable content (only headings, blanks, empty list items).
 */
export function isHeartbeatContentEmpty(content: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#+(\s|$)/.test(trimmed)) continue;
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
    return false;
  }
  return true;
}
