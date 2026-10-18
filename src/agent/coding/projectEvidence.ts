import { createHash } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Share repeated evidence only in model input; the authoritative transcript stays intact. */
export function projectWorkEvidence(source: readonly AgentMessage[]): {
  messages: AgentMessage[]; sharedReviews: number; sharedReads: number; sharedWriteArguments: number; savedChars: number;
} {
  const messages = [...source];
  let review: { id: string; lines: string[] } | undefined;
  const reads = new Map<string, string>();
  let savedChars = 0;
  const sharedReviews = new Set<number>(), sharedReads = new Set<number>();
  const writeCalls = new Map<string, { path: string; content: string }>();
  const successfulWritePaths = new Map<string, string>();
  const written = new Map<string, { id: string; path: string; content: string }>();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type !== 'toolCall' || block.name !== 'write_file') continue;
        const args = record(block.arguments);
        if (typeof args.path === 'string' && typeof args.content === 'string') writeCalls.set(block.id, { path: args.path.replace(/^\.\//, ''), content: args.content });
      }
    }
    if (message.role !== 'toolResult' || message.isError || message.content.some(block => block.type !== 'text')) continue;
    const details = record(message.details);
    if (message.toolName === 'write_file' && typeof details.path === 'string') {
      const call = writeCalls.get(message.toolCallId);
      if (call && !['failed', 'blocked', 'timed_out', 'cancelled', 'interrupted'].includes(String(details.status))) {
        written.set(details.path, { ...call, id: message.toolCallId });
        successfulWritePaths.set(message.toolCallId, details.path);
      }
      continue;
    }
    const reference = (write: { id: string; content: string }) =>
      `[Identical content retained in successful write_file call ${write.id}, arguments.content; SHA-256 ${createHash('sha256').update(write.content).digest('hex')}. Reuse that full text. This reference is not a new read, write, or verification.]`;
    let saved = 0;
    const content = message.content.map(block => {
      if (block.type !== 'text') return block;
      let text = block.text;
      if (message.toolName === 'read_file' && details.truncated === false && details.offset === 1 && typeof details.path === 'string') {
        const write = written.get(details.path) ?? [...written.values()].find(item => item.content === text);
        if (write && text === write.content && text.length > 1024) {
          const replacement = reference(write);
          if (replacement.length + 256 < text.length) text = replacement;
        }
      } else if (message.toolName === 'review_workspace' && details.complete === true && record(details.verification).status === 'passed') {
        for (const write of written.values()) {
          if (write.content.length <= 1024 || /[\r\n]/.test(write.path)) continue;
          const prefix = `\nUntracked file: ${write.path}\n`;
          const start = text.indexOf(prefix + write.content);
          if (start < 0) continue;
          const end = start + prefix.length + write.content.length;
          if (end !== text.length && !text.slice(end).startsWith('\nUntracked file: ')) continue;
          const replacement = reference(write);
          if (replacement.length + 256 < write.content.length) text = text.slice(0, start) + prefix + replacement + text.slice(end);
        }
      }
      saved += block.text.length - text.length;
      return text === block.text ? block : { ...block, text };
    });
    if (saved > 0) {
      messages[index] = { ...message, content };
      savedChars += saved;
      if (message.toolName === 'read_file') sharedReads.add(index); else sharedReviews.add(index);
    }
  }
  let sharedWriteArguments = 0;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    let changed = false;
    const content = message.content.map(block => {
      if (block.type !== 'toolCall' || block.name !== 'write_file') return block;
      const args = record(block.arguments);
      const path = successfulWritePaths.get(block.id);
      const latest = path ? written.get(path) : undefined;
      if (!latest || latest.id === block.id || typeof args.content !== 'string' || args.content.length <= 1024) return block;
      const older = args.content.split('\n'), base = latest.content.split('\n');
      let prefix = 0, suffix = 0;
      while (prefix < Math.min(older.length, base.length) && older[prefix] === base[prefix]) prefix++;
      while (suffix < Math.min(older.length, base.length) - prefix && older[older.length - 1 - suffix] === base[base.length - 1 - suffix]) suffix++;
      const encoded = '[xopc historical argument encoding; not literal file contents]\n' + JSON.stringify({
        referenceToolCallId: latest.id,
        referenceSha256: createHash('sha256').update(latest.content).digest('hex'),
        originalSha256: createHash('sha256').update(args.content).digest('hex'),
        prefixLines: prefix, suffixLines: suffix,
        middleLines: older.slice(prefix, older.length - suffix),
        meaning: 'Reconstruct this historical arguments.content from the referenced full write: prefix lines + middleLines + suffix lines. No new execution or verification is implied.',
      });
      if (encoded.length >= args.content.length || JSON.stringify(encoded).length + 512 >= JSON.stringify(args.content).length) return block;
      savedChars += args.content.length - encoded.length;
      sharedWriteArguments++;
      changed = true;
      return { ...block, arguments: { ...args, content: encoded } };
    });
    if (changed) messages[index] = { ...message, content };
  }
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
    if (message.toolName === 'review_workspace') sharedReviews.add(index); else sharedReads.add(index);
    savedChars += text.length - replacement.length;
  }
  return { messages, sharedReviews: sharedReviews.size, sharedReads: sharedReads.size, sharedWriteArguments, savedChars };
}
