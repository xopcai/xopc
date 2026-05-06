/**
 * OpenClaw-style partial session row updates: merge tags and shallow-merge customData.
 */

import type { SessionMetadata } from './types.js';

export type SessionPatchBody = {
  name?: string;
  tags?: string[];
  /** When true, `tags` replaces the tag list; otherwise tags are union-merged. */
  replaceTags?: boolean;
  customData?: Record<string, unknown>;
};

export function applySessionPatchToMetadata(
  existing: SessionMetadata,
  patch: SessionPatchBody,
): Partial<SessionMetadata> {
  const out: Partial<SessionMetadata> = {};

  if (typeof patch.name === 'string') {
    const t = patch.name.trim();
    if (t.length > 0) {
      out.name = t;
    } else {
      out.name = undefined;
    }
  }

  if (patch.tags !== undefined && Array.isArray(patch.tags)) {
    const normalized = [...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))];
    if (patch.replaceTags) {
      out.tags = normalized;
    } else {
      out.tags = [...new Set([...existing.tags, ...normalized])];
    }
  }

  if (patch.customData !== undefined && typeof patch.customData === 'object' && patch.customData !== null) {
    out.customData = { ...(existing.customData ?? {}), ...patch.customData };
  }

  return out;
}
