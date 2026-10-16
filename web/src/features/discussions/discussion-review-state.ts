import { create } from 'zustand';
export interface DiscussionReviewState { tab: 'summary' | 'transcript' | 'marks'; query: string; page: number; positionMs: number; source?: string; anchor?: number; anchorRevision?: number }
const defaults: DiscussionReviewState = { tab: 'summary', query: '', page: 1, positionMs: 0 };
export const useDiscussionReviewState = create<{ notes: Record<string,DiscussionReviewState>; update: (id: string,patch: Partial<DiscussionReviewState>) => void }>((set,get) => ({
  notes: {},
  update: (id,patch) => {
    const next = { ...readReviewState(id,get().notes[id]),...patch };
    set(state => ({ notes: { ...state.notes,[id]: next } }));
    try { localStorage.setItem(`discussion-review:${id}`,JSON.stringify(next)); } catch { /* Playback remains usable when browser storage is full. */ }
  },
}));
const cache = new Map<string,DiscussionReviewState>();
export function readReviewState(id: string,current?: DiscussionReviewState): DiscussionReviewState {
  if (current) return current;
  if (cache.has(id)) return cache.get(id)!;
  let state = defaults;
  try {
    const saved = JSON.parse(localStorage.getItem(`discussion-review:${id}`) ?? 'null') as DiscussionReviewState | null;
    if (saved && ['summary','transcript','marks'].includes(saved.tab) && typeof saved.query === 'string' && Number.isSafeInteger(saved.page) && saved.page > 0 && saved.page <= 10000 && Number.isFinite(saved.positionMs) && saved.positionMs >= 0) state = { ...defaults,...saved };
  } catch { /* Restore safely after malformed persisted state. */ }
  cache.set(id,state); return state;
}
