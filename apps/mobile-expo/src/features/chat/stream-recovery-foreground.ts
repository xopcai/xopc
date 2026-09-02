export type ForegroundRecoveryInput = {
  previousAppState: string;
  nextAppState: string;
  sessionIsActive: boolean;
};

export function shouldWakeStreamRecoveryOnForeground(input: ForegroundRecoveryInput): boolean {
  return input.previousAppState !== 'active'
    && input.nextAppState === 'active'
    && input.sessionIsActive;
}
