/**
 * Cross-panel "save bar" coordination for the Models & credentials hub.
 *
 * Each embedded settings panel (providers / models / image / voice / search)
 * registers itself here so the hub can render a single "Save all" / "Discard
 * all" bar on top of its accordion. Sections still own their own save logic
 * — this store is purely a coordination layer; it doesn't replicate or
 * replace any panel's local state machine.
 *
 * Save semantics: per-section saves run in registration order. A failure
 * in one section is reported but does not abort subsequent sections — those
 * sections are independent in production (separate config branches, often
 * separate stores), so partial-success surfaced to the user is the safest
 * default.
 *
 * Performance: the store pre-computes `anyDirty`, `dirtyCount`, and
 * `anySaving` as top-level fields so consumers can subscribe to scalar
 * values via zustand selectors without iterating the sections Map on every
 * render. Recomputation only runs inside `registerSection` /
 * `unregisterSection` — the same paths that already caused a `set()`.
 */

import { create } from 'zustand';

export interface SaveBarSection {
  /** Stable id (e.g. `providers`, `voice`). */
  id: string;
  dirty: boolean;
  saving: boolean;
  /** Resolves once the panel's local save completes; returns an outcome. */
  save: () => Promise<{ ok: boolean; error?: string }>;
  discard: () => void;
}

export interface SaveAllFailure {
  id: string;
  error: string;
}

export interface SaveAllOutcome {
  ok: boolean;
  saved: number;
  failures: SaveAllFailure[];
}

interface State {
  /** Insertion-ordered map keeps save order deterministic and matches the hub's section layout. */
  sections: Map<string, SaveBarSection>;
  /** True while a `saveAll` invocation is in flight (separate from per-section `saving`). */
  saveAllInFlight: boolean;

  // Pre-computed aggregates — consumers subscribe to these scalars directly.
  anyDirty: boolean;
  dirtyCount: number;
  anySaving: boolean;

  registerSection: (section: SaveBarSection) => void;
  unregisterSection: (id: string) => void;
  saveAll: () => Promise<SaveAllOutcome>;
  discardAll: () => void;
}

function computeAggregates(sections: Map<string, SaveBarSection>, saveAllInFlight: boolean) {
  let anyDirty = false;
  let dirtyCount = 0;
  let anySaving = saveAllInFlight;
  for (const s of sections.values()) {
    if (s.dirty) {
      anyDirty = true;
      dirtyCount += 1;
    }
    if (s.saving) anySaving = true;
  }
  return { anyDirty, dirtyCount, anySaving };
}

export const useSaveBarStore = create<State>((set, get) => ({
  sections: new Map(),
  saveAllInFlight: false,
  anyDirty: false,
  dirtyCount: 0,
  anySaving: false,

  registerSection: (section) => {
    set((state) => {
      const next = new Map(state.sections);
      next.set(section.id, section);
      return { sections: next, ...computeAggregates(next, state.saveAllInFlight) };
    });
  },

  unregisterSection: (id) => {
    set((state) => {
      if (!state.sections.has(id)) return state;
      const next = new Map(state.sections);
      next.delete(id);
      return { sections: next, ...computeAggregates(next, state.saveAllInFlight) };
    });
  },

  saveAll: async () => {
    const sections = Array.from(get().sections.values()).filter((s) => s.dirty);
    if (sections.length === 0) {
      return { ok: true, saved: 0, failures: [] };
    }
    set((state) => ({ saveAllInFlight: true, ...computeAggregates(state.sections, true) }));
    const failures: SaveAllFailure[] = [];
    let saved = 0;
    try {
      const outcomes = await Promise.all(
        sections.map(async (section) => {
          try {
            const result = await section.save();
            return { id: section.id, result };
          } catch (err) {
            return {
              id: section.id,
              result: {
                ok: false as const,
                error: err instanceof Error ? err.message : String(err),
              },
            };
          }
        }),
      );
      for (const { id, result } of outcomes) {
        if (result.ok) saved += 1;
        else failures.push({ id, error: result.error ?? 'Save failed' });
      }
    } finally {
      set((state) => ({ saveAllInFlight: false, ...computeAggregates(state.sections, false) }));
    }
    return { ok: failures.length === 0, saved, failures };
  },

  discardAll: () => {
    for (const section of get().sections.values()) {
      if (section.dirty) section.discard();
    }
  },
}));

/** @deprecated Use `state.anyDirty` directly as a zustand selector. */
export function selectAnyDirty(state: State): boolean {
  return state.anyDirty;
}

/** @deprecated Use `state.dirtyCount` directly as a zustand selector. */
export function selectDirtyCount(state: State): number {
  return state.dirtyCount;
}

/** @deprecated Use `state.anySaving` directly as a zustand selector. */
export function selectAnySaving(state: State): boolean {
  return state.anySaving;
}
