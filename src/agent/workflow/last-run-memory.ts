/**
 * Per-session memory of the most recent workflow script that ran successfully.
 *
 * Purpose: enable `/workflow save <name>` — the user sees a workflow run,
 * likes it, types `/workflow save audit_repo_strict`, and the model-generated
 * script lands in `~/.xopc/workflows/`.
 *
 * Scope decision (KISS):
 * - In-memory only, keyed by sessionKey. Cleared on process restart. OPC is
 *   long-lived per session, so the practical window is "from when the user
 *   ran the workflow until they save it" — minutes, not days. Persisting
 *   across restarts would require either session-store coupling or a separate
 *   sidecar file, both bigger than the value.
 * - Records on EVERY successful workflow tool execution, including runs by
 *   name (so users can re-save a slightly modified built-in too).
 * - Bounded by a small LRU so a runaway never grows the heap.
 */

const DEFAULT_MAX_ENTRIES = 64;

export interface LastWorkflowEntry {
  /** Raw workflow script as the runtime saw it (post-fence-strip, pre-parse). */
  script: string;
  /** meta.name from the script (used to default a save target). */
  metaName: string;
  /** Where the script came from on this run — for save-time UX hints. */
  source: 'name' | 'script';
  /** ms since epoch when recorded — UI uses this for "ran 2 min ago". */
  recordedAt: number;
}

class LastWorkflowMemoryImpl {
  private readonly entries = new Map<string, LastWorkflowEntry>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  record(sessionKey: string | undefined, entry: LastWorkflowEntry): void {
    if (!sessionKey) return;
    // Move-to-end semantics: delete then set so iteration order = LRU.
    if (this.entries.has(sessionKey)) this.entries.delete(sessionKey);
    this.entries.set(sessionKey, entry);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  get(sessionKey: string | undefined): LastWorkflowEntry | undefined {
    if (!sessionKey) return undefined;
    return this.entries.get(sessionKey);
  }

  clear(sessionKey?: string): void {
    if (sessionKey === undefined) this.entries.clear();
    else this.entries.delete(sessionKey);
  }

  /** Visible for tests; do not consume from production code. */
  _size(): number {
    return this.entries.size;
  }
}

export type LastWorkflowMemory = LastWorkflowMemoryImpl;

let singleton: LastWorkflowMemoryImpl | null = null;

export function getLastWorkflowMemory(): LastWorkflowMemoryImpl {
  if (!singleton) singleton = new LastWorkflowMemoryImpl();
  return singleton;
}

/** Reset the singleton (tests only). */
export function _resetLastWorkflowMemoryForTests(): void {
  singleton = null;
}
