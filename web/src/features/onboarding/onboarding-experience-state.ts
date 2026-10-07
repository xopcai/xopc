import type { WorkDiscoveryOnboardingSnapshot } from '@/features/work-discovery/api';

export type OnboardingExperienceState = {
  open: boolean;
  stage: 'setup' | 'cloud' | 'work';
};

export function hasPendingWorkDiscovery(snapshot: WorkDiscoveryOnboardingSnapshot | null): boolean {
  return snapshot?.enabled === true
    && (snapshot.state.status === 'not_started' || snapshot.state.status === 'in_progress');
}

export function deriveOnboardingExperienceState(input: {
  authenticated: boolean;
  desktop: boolean;
  settingsRoute: boolean;
  modelSetupReady: boolean;
  needsModelSetup: boolean;
  modelGuideDismissed: boolean;
  cloudOnboardingReady: boolean;
  cloudOnboardingPending: boolean;
  workDiscovery: WorkDiscoveryOnboardingSnapshot | null;
  closed: boolean;
}): OnboardingExperienceState {
  const requiredSetup = !input.settingsRoute && input.modelSetupReady
    && input.needsModelSetup && !input.modelGuideDismissed;
  const cloudPending = input.cloudOnboardingReady && input.cloudOnboardingPending
    && (!input.desktop || input.modelSetupReady)
    && !(input.desktop && requiredSetup);
  const setupPending = requiredSetup && !cloudPending;
  const workPending = !cloudPending && !input.settingsRoute && input.modelSetupReady
    && !input.needsModelSetup && hasPendingWorkDiscovery(input.workDiscovery);
  const eligible = input.authenticated
    && !input.closed;

  return {
    open: eligible && (setupPending || cloudPending || workPending),
    stage: cloudPending ? 'cloud' : setupPending ? 'setup' : 'work',
  };
}
