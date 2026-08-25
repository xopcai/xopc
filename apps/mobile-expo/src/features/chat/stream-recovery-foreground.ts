export type ForegroundRecoveryInput = {
  previousAppState: string;
  nextAppState: string;
  sessionIsActive: boolean;
  hasResumableWork: boolean;
};

export function shouldWakeStreamRecoveryOnForeground(input: ForegroundRecoveryInput): boolean {
  return input.previousAppState !== 'active'
    && input.nextAppState === 'active'
    && input.sessionIsActive
    && input.hasResumableWork;
}
