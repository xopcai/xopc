import { useGatewayStore } from '@/stores/gateway-store';

export type PreviewViewState = { zoom: number; rotation: number; page: number; pageCount: number | null; searchQuery: string; scroll: number[]; sourceEditMode?: boolean };
const views = new Map<string, PreviewViewState>();
export function readPreviewView(id: string): PreviewViewState {
  return views.get(id) ?? { zoom: 1, rotation: 0, page: 1, pageCount: null, searchQuery: '', scroll: [] };
}
export function savePreviewView(id: string, update: Partial<PreviewViewState>) {
  const state = { ...readPreviewView(id), ...update };
  views.delete(id);
  views.set(id, state);
  while (views.size > 100) views.delete(views.keys().next().value!);
}
export function deletePreviewView(id: string) { views.delete(id); }
useGatewayStore.subscribe((state, previous) => {
  if (state.baseUrl !== previous.baseUrl || state.conversationId !== previous.conversationId) views.clear();
});
