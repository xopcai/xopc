import type { WebchatPersistentGoalWire } from '@/features/chat/goals-api';

import { GoalJudgementSummary } from './chat-goal-judgement-summary';
import type { GoalMessages } from './chat-goal-banner-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  t: GoalMessages;
};

export function GoalDetailsToggle({ goal, t }: Props) {
  return <GoalJudgementSummary goal={goal} t={t} />;
}
