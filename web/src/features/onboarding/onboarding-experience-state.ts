import type { WorkDiscoveryOnboardingSnapshot } from '@/features/work-discovery/api';

export type OnboardingExperienceState = {
  open: boolean;
  stage: 'setup' | 'work';
};

export function hasPendingWorkDiscovery(snapshot: WorkDiscoveryOnboardingSnapshot | null): boolean {
  return snapshot?.enabled === true
    && (snapshot.state.status === 'not_started' || snapshot.state.status === 'in_progress');
}

export function deriveOnboardingExperienceState(input: {
  authenticated: boolean;
  settingsRoute: boolean;
  modelSetupReady: boolean;
  needsModelSetup: boolean;
  modelGuideDismissed: boolean;
  workDiscovery: WorkDiscoveryOnboardingSnapshot | null;
  closed: boolean;
}): OnboardingExperienceState {
  const setupPending = input.needsModelSetup && !input.modelGuideDismissed;
  const workPending = !input.needsModelSetup && hasPendingWorkDiscovery(input.workDiscovery);
  const eligible = input.authenticated
    && !input.settingsRoute
    && input.modelSetupReady
    && !input.closed;

  return {
    open: eligible && (setupPending || workPending),
    stage: setupPending ? 'setup' : 'work',
  };
}
