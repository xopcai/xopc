import { GoalService, type GoalEvidence } from '../../goals/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('GoalEvidence');

export type GoalEvidenceRecordInput = Pick<GoalEvidence, 'kind' | 'title' | 'summary' | 'uri' | 'data'>;

export interface GoalEvidenceRecorderOptions {
  getSessionKey: () => string | undefined;
}

export function createGoalEvidenceRecorder(options: GoalEvidenceRecorderOptions) {
  const goals = new GoalService();
  return async (input: GoalEvidenceRecordInput): Promise<void> => {
    const sessionKey = options.getSessionKey()?.trim();
    if (!sessionKey) return;
    const goal = goals.getActiveForSession(sessionKey);
    if (!goal || goal.status !== 'active') return;
    try {
      goals.addEvidence({
        goalId: goal.id,
        runId: goal.currentRunId,
        ...input,
      });
    } catch (err) {
      log.warn(
        { err, sessionKey, goalId: goal.id, kind: input.kind },
        `Goal evidence record failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
