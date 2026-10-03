import {
  buildWelcomeSpotlight,
  type ProjectOperatingView,
  type WelcomeSpotlightCopy,
  type WelcomeSuggestionContext,
} from '@xopcai/gateway-contract';

import type { MessageBundle } from '../../i18n/messages';
import type { ProjectDetails } from '../../query/projects';
import type { TaskDetail } from '../../query/tasks';

export type MobileWelcomeStarter = {
  id: string;
  title: string;
  description: string;
  prompt: string;
};

export type MobileWelcomeModel = {
  headline: string;
  starters: MobileWelcomeStarter[];
};

export function buildMobileWelcomeModel({
  messages,
  project,
  projectOperating,
  task,
}: {
  messages: MessageBundle;
  project?: ProjectDetails | null;
  projectOperating?: ProjectOperatingView | null;
  task?: TaskDetail | null;
}): MobileWelcomeModel {
  const latestTaskReceipt = task?.receipts[0];
  const projectBlocker = projectOperating?.blockers[0];
  const failedProjectResult = projectOperating?.digest.health === 'attention'
    ? projectOperating.recentResults.find(
        ({ receipt }) => receipt.status === 'failed' || receipt.verification.status === 'failed',
      )
    : undefined;
  const context: WelcomeSuggestionContext = task
    ? {
        kind: 'task',
        taskId: task.task.id,
        taskTitle: task.task.title,
        phase: task.task.phase,
        operationalState: task.operationalState,
        attentionSummary: task.attention[0]?.summary,
        nextAction: latestTaskReceipt?.nextAction,
        recentFailure: latestTaskReceipt?.failure?.recoveryAction,
      }
    : project
      ? {
          kind: 'project',
          projectId: project.id,
          projectName: project.name,
          recommendedAction: projectOperating?.digest.recommendedAction,
          blockedReason: projectBlocker?.detail ?? projectBlocker?.title,
          recentFailure:
            failedProjectResult?.receipt.failure?.recoveryAction ?? failedProjectResult?.receipt.summary,
        }
      : { kind: 'empty' };
  const spotlight = buildWelcomeSpotlight(
    context,
    messages.chat.welcomeSpotlight as WelcomeSpotlightCopy,
  );
  const recommendation = spotlight.recommendation;
  return {
    headline: spotlight.headline,
    starters: recommendation
      ? [{
          id: recommendation.id,
          title: recommendation.title,
          description: recommendation.reason,
          prompt: recommendation.prompt,
        }]
      : [],
  };
}
