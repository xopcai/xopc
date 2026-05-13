import type { SessionMetadata } from '../types.js';

/**
 * One value in `sessions.json` (OpenClaw SessionEntry–shaped subset + xopc metadata bag).
 */
export interface XopcSessionDiskEntry extends Record<string, unknown> {
  sessionId: string;
  updatedAt: number;
  sessionStartedAt?: number;
  sessionFile?: string;
  pluginExtensions?: {
    xopc?: {
      /** Full {@link SessionMetadata} including `key`. */
      metadata: SessionMetadata;
    };
  };
}
