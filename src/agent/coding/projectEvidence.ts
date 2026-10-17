import { createHash } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Share repeated evidence only in model input; the authoritative transcript stays intact. */
export function projectWorkEvidence(source: readonly AgentMessage[]): {
  messages: AgentMessage[]; sharedReviews: number; sharedReads: number; savedChars: number;
} {
  const messages = [...source];
  let review: { id: string; lines: string[] } | undefined;
  const reads = new Map<string, string>();
  let sharedReviews = 0, sharedReads = 0, savedChars = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'user') { review = undefined; reads.clear(); }
    if (message.role !== 'toolResult' || message.isError || message.content.some(block => block.type !== 'text')) continue;
    const details = record(message.details);
    const text = message.content.map(block => block.type === 'text' ? block.text : '').join('\n');
    let replacement = '';
    if (message.toolName === 'review_workspace' && details.complete === true
      && record(details.verification).status === 'passed' && typeof details.workspaceRevision === 'string') {
      const lines = text.split('\n');
      if (review) {
        let prefix = 0, suffix = 0;
        while (prefix < Math.min(lines.length, review.lines.length) && lines[prefix] === review.lines[prefix]) prefix++;
        while (suffix < Math.min(lines.length, review.lines.length) - prefix
          && lines[lines.length - 1 - suffix] === review.lines[review.lines.length - 1 - suffix]) suffix++;
        const middle = lines.slice(prefix, lines.length - suffix);
        replacement = `Earlier workspace review: reuse the first ${prefix} lines and last ${suffix} lines of the last complete review in this user turn (original receipt ${review.id}). The differing lines from THIS earlier review are:\n${middle.length ? middle.join('\n') : '(no differing lines)'}\n[End earlier differing lines. This is context sharing, not a new review or verification.]`;
      } else review = { id: message.toolCallId, lines };
    } else if (message.toolName === 'read_file' && details.truncated === false && typeof details.path === 'string') {
      const key = createHash('sha256').update(JSON.stringify([details.path, details.offset, details.totalLines, message.content])).digest('hex');
      const later = reads.get(key);
      if (later) replacement = `Identical successful read of ${details.path}; use the later retained read_file result for the same file and excerpt (original receipt ${later}). No new read is implied by this context reference.`;
      else reads.set(key, message.toolCallId);
    }
    if (!replacement || replacement.length + 256 >= text.length) continue;
    messages[index] = { ...message, content: [{ type: 'text', text: replacement }] };
    if (message.toolName === 'review_workspace') sharedReviews++; else sharedReads++;
    savedChars += text.length - replacement.length;
  }
  return { messages, sharedReviews, sharedReads, savedChars };
}
