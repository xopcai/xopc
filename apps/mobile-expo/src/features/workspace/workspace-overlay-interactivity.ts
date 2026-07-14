import type { WorkspaceTransitionPhase } from './workspace-transition.types';

export function isWorkspaceChatOverlayInteractive(phase: WorkspaceTransitionPhase): boolean {
  return phase === 'opening' || phase === 'open';
}
