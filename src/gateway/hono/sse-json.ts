import { createLogger } from '../../utils/logger.js';

const log = createLogger('Hono:SSE');

/**
 * Serialize SSE `data:` JSON lines. Uses a BigInt replacer and catches
 * JSON.stringify failures (circular refs, exotic values) so the stream does not
 * abort mid-run — otherwise later events (e.g. `tool_end`, `result`) never reach
 * the client and the UI can stick on a running tool.
 */
export function stringifySSEData(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch (err) {
    log.warn({ err }, 'SSE JSON.stringify failed; sending fallback');
    const t =
      value && typeof value === 'object' && value !== null && 'type' in value
        ? String((value as { type?: unknown }).type)
        : 'message';
    try {
      return JSON.stringify({
        type: t,
        error: 'sse_payload_serialize_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } catch {
      return JSON.stringify({ type: 'message', error: 'sse_payload_serialize_failed' });
    }
  }
}
