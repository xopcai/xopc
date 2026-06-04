import type { SessionMetadata } from '../types.js';

/**
 * One value in `sessions.json` (OpenClaw SessionEntry–shaped subset + xopc metadata bag).
 */
export interface XopcSessionDiskEntry extends Record<string, unknown> {
  sessionId: string;
  updatedAt: number;
  sessionStartedAt?: number;
  /** Last user/channel interaction (ms) — extends idle reset lifetime. */
  lastInteractionAt?: number;
  /** Persisted thinking level (OpenClaw SessionEntry parity). */
  thinkingLevel?: string;
  /** Persisted verbose level (OpenClaw SessionEntry parity). */
  verboseLevel?: string;
  sessionFile?: string;
  pluginExtensions?: {
    xopc?: {
      /** Full {@link SessionMetadata} including `key`. */
      metadata: SessionMetadata;
    };
  };
}
