/**
 * Built-in curated memory (MEMORY.md + USER.md under the agent home `memories/` dir).
 */

export interface MemoryStoreConfig {
  workspaceDir: string;
  /** Absolute path to `…/agents/<id>/memories/` (not under markdown workspace). */
  memoriesDir: string;
  /** Max chars for MEMORY.md entries (excluding delimiter overhead in limit check uses joined body). */
  memoryCharLimit: number;
  /** Max chars for USER.md entries. */
  userCharLimit: number;
  /** When false, USER.md is not loaded into the snapshot or shown in the system prompt. */
  userProfileEnabled?: boolean;
}

/** Frozen at session start; not updated when tools mutate disk mid-session. */
export interface MemorySnapshot {
  memory: string;
  user: string;
}
