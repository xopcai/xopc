export type CellRenderMode = 'compact' | 'transcript' | 'raw';

export interface ModeAwareCell {
  setRenderMode(mode: CellRenderMode): void;
}
