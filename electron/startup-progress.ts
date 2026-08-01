export type StartupProgressPhase =
  | 'preparing-workspace'
  | 'checking-core'
  | 'starting-core'
  | 'connecting-assistant'
  | 'opening-workspace';

export interface StartupProgressDetail {
  phase: StartupProgressPhase;
}

export type StartupProgressReporter = (detail: StartupProgressDetail) => void;
