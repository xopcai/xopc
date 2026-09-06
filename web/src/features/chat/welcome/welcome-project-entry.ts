export type WorkDiscoveryOnboardingState = {
  enabled: boolean;
  state: {
    status: 'not_started' | 'in_progress' | 'completed' | 'dismissed';
    activeRunId?: string;
  };
};

export type WelcomeProjectEntryMode =
  | 'hidden'
  | 'choose_project'
  | 'discover_folder'
  | 'resume_discovery';

export function resolveWelcomeProjectEntryMode(input: {
  contextKind: string;
  projectId?: string | null;
  projectCount: number;
  workDiscovery: WorkDiscoveryOnboardingState | null;
}): WelcomeProjectEntryMode {
  if (input.projectId || input.contextKind !== 'empty') return 'hidden';
  if (input.projectCount > 0) return 'choose_project';
  if (!input.workDiscovery?.enabled) return 'hidden';

  if (
    input.workDiscovery.state.status === 'in_progress' &&
    input.workDiscovery.state.activeRunId
  ) {
    return 'resume_discovery';
  }
  if (input.workDiscovery.state.status === 'not_started') return 'discover_folder';
  return 'hidden';
}
