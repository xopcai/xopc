/**
 * Normalize outbound payloads before adapter delivery.
 */

import type { ChannelPlugin } from '../plugin-types.js';

export function normalizePayloadForPlugin(payload: unknown, _plugin: ChannelPlugin): unknown {
  return payload;
}
