export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkspaceTransitionPhase = 'closed' | 'opening' | 'open' | 'closing';

export type LayoutMeasurer = () => Promise<LayoutRect | null>;

export type FinalizeAskAiHandler = () => void;
