import { describe, expect, it } from 'vitest';

import { deriveOnboardingExperienceState } from '../onboarding-experience-state';

const base = {
  authenticated: true,
  settingsRoute: false,
  modelSetupReady: true,
  needsModelSetup: false,
  modelGuideDismissed: false,
  workDiscovery: null,
  closed: false,
};

describe('onboarding experience state', () => {
  it('opens user understanding when the model was already configured', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      workDiscovery: { enabled: true, state: { status: 'not_started' } },
    })).toEqual({ open: true, stage: 'work' });
  });

  it('keeps model setup first while both stages are pending', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      needsModelSetup: true,
      workDiscovery: { enabled: true, state: { status: 'not_started' } },
    })).toEqual({ open: true, stage: 'setup' });
  });

  it('does not start understanding when required model setup was dismissed', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      needsModelSetup: true,
      modelGuideDismissed: true,
      workDiscovery: { enabled: true, state: { status: 'not_started' } },
    })).toEqual({ open: false, stage: 'work' });
  });

  it.each(['completed', 'dismissed'] as const)('does not reopen completed work onboarding (%s)', (status) => {
    expect(deriveOnboardingExperienceState({
      ...base,
      workDiscovery: { enabled: true, state: { status } },
    })).toEqual({ open: false, stage: 'work' });
  });

  it('closes the current experience without changing the derived stage', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      closed: true,
      workDiscovery: { enabled: true, state: { status: 'in_progress', activeRunId: 'run-1' } },
    })).toEqual({ open: false, stage: 'work' });
  });
});
