import type { PaginatedResult, SessionListQuery, SessionMetadata } from './types.js';

/** Minimal session index reader needed by channel delivery adapters. */
export interface SessionListReader {
  list(query?: SessionListQuery): Promise<PaginatedResult<SessionMetadata>>;
}
