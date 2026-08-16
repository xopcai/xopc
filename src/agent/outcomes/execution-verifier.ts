export type ExecutionVerificationStatus = 'passed' | 'failed' | 'unverified';
export type ExecutionFailurePhase = 'planning' | 'execution' | 'verification' | 'approval' | 'runtime';
export type ExecutionFailureCode = 'cancelled' | 'timeout' | 'tool_failed' | 'verification_failed' | 'approval_required' | 'conflict' | 'model_failed' | 'unknown';
export type ExecutionRecoveryAction = 'replan' | 'retry_with_changed_strategy' | 'request_user_input' | 'none';

export interface ExecutionVerification {
  status: ExecutionVerificationStatus;
  checks: Array<{
    criterion: string;
    status: ExecutionVerificationStatus;
    evidenceTitles: string[];
  }>;
}

export interface ExecutionFailureDiagnosis {
  code: ExecutionFailureCode;
  phase: ExecutionFailurePhase;
  recoveryAction: ExecutionRecoveryAction;
}

export function verifyExecutionCompletion(input: {
  status: 'succeeded' | 'failed' | 'cancelled';
  acceptanceCriteria: string[];
  evidence: Array<{ title: string; verifies?: string[] }>;
}): ExecutionVerification {
  const checks = input.acceptanceCriteria.map((criterion) => {
    const evidenceTitles = input.evidence
      .filter((evidence) => evidence.verifies?.includes(criterion))
      .map((evidence) => evidence.title);
    return {
      criterion,
      status: evidenceTitles.length > 0 ? 'passed' as const : 'unverified' as const,
      evidenceTitles,
    };
  });
  if (input.status === 'failed' || input.status === 'cancelled') {
    return { status: 'failed', checks: checks.map((check) => ({ ...check, status: 'failed' })) };
  }
  if (checks.length === 0 || checks.some((check) => check.status !== 'passed')) {
    return { status: 'unverified', checks };
  }
  return { status: 'passed', checks };
}

export function diagnoseExecutionFailure(input: {
  status: 'failed' | 'cancelled';
  summary: string;
}): ExecutionFailureDiagnosis {
  const text = input.summary.toLocaleLowerCase();
  if (input.status === 'cancelled') return { code: 'cancelled', phase: 'runtime', recoveryAction: 'none' };
  if (/timeout|timed out|deadline exceeded/.test(text)) return { code: 'timeout', phase: 'runtime', recoveryAction: 'retry_with_changed_strategy' };
  if (/approval|permission|authorization|forbidden/.test(text)) return { code: 'approval_required', phase: 'approval', recoveryAction: 'request_user_input' };
  if (/test|typecheck|lint|build|verification|acceptance/.test(text)) return { code: 'verification_failed', phase: 'verification', recoveryAction: 'replan' };
  if (/already processing|conflict|locked|concurrent/.test(text)) return { code: 'conflict', phase: 'execution', recoveryAction: 'retry_with_changed_strategy' };
  if (/tool|command|exit code|enoent|not found/.test(text)) return { code: 'tool_failed', phase: 'execution', recoveryAction: 'replan' };
  if (/model|provider|rate limit|context length/.test(text)) return { code: 'model_failed', phase: 'runtime', recoveryAction: 'retry_with_changed_strategy' };
  return { code: 'unknown', phase: 'execution', recoveryAction: 'replan' };
}
