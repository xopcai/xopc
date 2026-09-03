import type { AgentToolResult } from '@earendil-works/pi-agent-core';

const MAX_TRANSPORT_RESULT_BYTES = 160 * 1024;
const MAX_TRANSPORT_TEXT_BYTES = 96 * 1024;

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const suffix = '\n[remote result truncated]';
  const available = Math.max(0, maxBytes - Buffer.byteLength(suffix));
  return `${Buffer.from(value).subarray(0, available).toString('utf8')}${suffix}`;
}

/** Keep workspace results below the authenticated realtime client-frame limit. */
export function boundWorkspaceToolResultForTransport(
  result: AgentToolResult<unknown>,
): AgentToolResult<unknown> {
  if (serializedBytes(result) <= MAX_TRANSPORT_RESULT_BYTES) return result;

  let remainingTextBytes = MAX_TRANSPORT_TEXT_BYTES;
  const content = result.content.map((block) => {
    if (block.type !== 'text') return block;
    const text = truncateUtf8(block.text, remainingTextBytes);
    remainingTextBytes = Math.max(0, remainingTextBytes - Buffer.byteLength(text));
    return { ...block, text };
  });
  const bounded: AgentToolResult<unknown> = {
    content,
    details: { remoteTransportTruncated: true },
  };
  if (serializedBytes(bounded) > MAX_TRANSPORT_RESULT_BYTES) {
    throw Object.assign(new Error('Workspace tool result exceeds the remote transport limit'), {
      code: 'RESULT_TOO_LARGE',
      retryable: false,
    });
  }
  return bounded;
}
