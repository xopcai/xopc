import type { WorkspaceTransitionPhase } from './workspace-transition.types';

export function shouldQueueWorkspaceOpen(phase: WorkspaceTransitionPhase): boolean {
  return phase === 'closing';
}
