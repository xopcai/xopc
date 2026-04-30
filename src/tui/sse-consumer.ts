import type { ParsedSSEEvent } from './tui-types.js';

/**
 * Consume an SSE stream from a `ReadableStream<Uint8Array>` (Node.js 22+ fetch body).
 *
 * Parses the standard SSE wire format:
 *   event: <name>\n
 *   data: <json>\n
 *   id: <id>\n
 *   \n
 *
 * Calls `onEvent` for each complete event block.
 */
export async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ParsedSSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentData = '';
  let currentId = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '') {
          // Empty line = end of event block
          if (currentData) {
            onEvent({
              event: currentEvent || 'message',
              data: currentData,
              id: currentId || undefined,
            });
          }
          currentEvent = '';
          currentData = '';
          currentId = '';
          continue;
        }

        if (line.startsWith(':')) {
          // Comment line, skip
          continue;
        }

        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const field = line.slice(0, colonIndex);
        // SSE spec: if there's a space after the colon, skip it
        const valueStart = line[colonIndex + 1] === ' ' ? colonIndex + 2 : colonIndex + 1;
        const fieldValue = line.slice(valueStart);

        switch (field) {
          case 'event':
            currentEvent = fieldValue;
            break;
          case 'data':
            currentData = currentData ? `${currentData}\n${fieldValue}` : fieldValue;
            break;
          case 'id':
            currentId = fieldValue;
            break;
        }
      }
    }
  } finally {
    buffer += decoder.decode();
    reader.releaseLock();
  }
}

/** Parse SSE data field as JSON, returning null on failure. */
export function parseSSEData<T = unknown>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
