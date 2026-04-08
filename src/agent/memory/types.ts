/**
 * Built-in curated memory (MEMORY.md + USER.md under `.xopcbot/memories/`).
 */

export interface MemoryStoreConfig {
  workspaceDir: string;
  /** Max chars for MEMORY.md entries (excluding delimiter overhead in limit check uses joined body). */
  memoryCharLimit: number;
  /** Max chars for USER.md entries. */
  userCharLimit: number;
}

/** Frozen at session start; not updated when tools mutate disk mid-session. */
export interface MemorySnapshot {
  memory: string;
  user: string;
}
