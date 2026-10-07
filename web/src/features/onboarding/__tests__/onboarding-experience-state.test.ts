import { describe, expect, it } from 'vitest';

import { deriveOnboardingExperienceState } from '../onboarding-experience-state';

const base = {
  authenticated: true,
  desktop: false,
  settingsRoute: false,
  modelSetupReady: true,
  needsModelSetup: false,
  modelGuideDismissed: false,
  cloudOnboardingReady: true,
  cloudOnboardingPending: false,
  workDiscovery: null,
  closed: false,
};

describe('onboarding experience state', () => {
  it('shows Cloud authorization even when an API key model is already usable', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      cloudOnboardingPending: true,
      workDiscovery: { enabled: true, state: { status: 'not_started' } },
    })).toEqual({ open: true, stage: 'cloud' });
  });

  it('shows the optional Cloud guide on a settings route without opening required setup', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      settingsRoute: true,
      needsModelSetup: true,
      cloudOnboardingPending: true,
    })).toEqual({ open: true, stage: 'cloud' });
  });

  it('does not open the Cloud guide while its status is loading', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      cloudOnboardingReady: false,
      cloudOnboardingPending: true,
    })).toEqual({ open: false, stage: 'work' });
  });
  it('opens user understanding when the model was already configured', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      workDiscovery: { enabled: true, state: { status: 'not_started' } },
    })).toEqual({ open: true, stage: 'work' });
  });

  it('guides Cloud authorization before required model setup', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      needsModelSetup: true,
      cloudOnboardingPending: true,
      workDiscovery: { enabled: true, state: { status: 'not_started' } },
    })).toEqual({ open: true, stage: 'cloud' });
  });

  it('opens the Cloud guide independently of model setup loading', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      modelSetupReady: false,
      cloudOnboardingPending: true,
    })).toEqual({ open: true, stage: 'cloud' });
  });

  it('continues to required model setup after the Cloud guide is dismissed', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      needsModelSetup: true,
      cloudOnboardingPending: false,
    })).toEqual({ open: true, stage: 'setup' });
  });

  it('keeps the Electron setup wizard first when no model is available', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      desktop: true,
      needsModelSetup: true,
      cloudOnboardingPending: true,
    })).toEqual({ open: true, stage: 'setup' });
  });

  it('shows the Cloud guide in Electron when an existing model is available', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      desktop: true,
      cloudOnboardingPending: true,
    })).toEqual({ open: true, stage: 'cloud' });
  });

  it('waits for model readiness before choosing the Electron guide', () => {
    expect(deriveOnboardingExperienceState({
      ...base,
      desktop: true,
      modelSetupReady: false,
      cloudOnboardingPending: true,
    })).toEqual({ open: false, stage: 'work' });
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
