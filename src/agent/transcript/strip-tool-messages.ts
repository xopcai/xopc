/**
 * Strip tool / toolResult rows from wire-format history (OpenClaw sessions-helpers pattern).
 * Use for display, summaries, or tools that need "last assistant text" without tool spans.
 */

export function stripToolMessages(messages: unknown[]): unknown[] {
  return messages.filter((msg) => {
    if (!msg || typeof msg !== 'object') {
      return true;
    }
    const role = (msg as { role?: unknown }).role;
    return role !== 'toolResult' && role !== 'tool';
  });
}
