import {
  buildWelcomeSpotlight,
  type WelcomeSpotlightCopy,
  type WelcomeSuggestionAgent,
  type WelcomeSuggestionContext,
} from '@xopcai/gateway-contract';
import type { ProjectOperatingView } from '@xopcai/gateway-contract';

import type { MessageBundle } from '../../i18n/messages';
import type { ChatAgentOption } from '../../query/agents';
import type { ProjectDetails } from '../../query/projects';
import type { TaskDetail } from '../../query/tasks';

export type MobileWelcomeStarter = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  icon: string;
};

export type MobileWelcomeModel = {
  headline: string;
  tagline: string;
  starters: MobileWelcomeStarter[];
};

function agentForWelcome(agent: ChatAgentOption | undefined, fallbackId: string): WelcomeSuggestionAgent {
  return {
    id: agent?.id ?? fallbackId,
    name: agent?.name,
    description: agent?.description,
    skills: [
      ...(agent?.skills.effectiveAllowlist ?? []),
      ...(agent?.skills.entry ?? []),
      ...(agent?.skills.defaults ?? []),
    ],
  };
}

function starterId(categoryId: string, index: number): string {
  return `${categoryId}:${index}`;
}

export function buildMobileWelcomeModel({
  messages,
  agent,
  agentId,
  effectiveWorkspacePath,
  project,
  projectOperating,
  task,
}: {
  messages: MessageBundle;
  agent?: ChatAgentOption;
  agentId: string;
  effectiveWorkspacePath?: string | null;
  project?: ProjectDetails | null;
  projectOperating?: ProjectOperatingView | null;
  task?: TaskDetail | null;
}): MobileWelcomeModel {
  const path = effectiveWorkspacePath?.trim();
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
          kind: 'generalProject',
          projectId: project.id,
          projectName: project.name,
          recommendedAction: projectOperating?.digest.recommendedAction,
          blockedReason: projectBlocker?.detail ?? projectBlocker?.title,
          recentFailure:
            failedProjectResult?.receipt.failure?.recoveryAction ?? failedProjectResult?.receipt.summary,
        }
      : path
        ? { kind: 'workingDirectory', path }
        : { kind: 'empty' };
  const spotlight = buildWelcomeSpotlight(
    context,
    messages.chat.welcomeSpotlight as WelcomeSpotlightCopy,
    agentForWelcome(agent, agentId || 'main'),
    {
      affinity: context.kind === 'empty' ? { 'explore-ai-news:0': 35 } : undefined,
      explorationSeed: new Date().toISOString().slice(0, 10),
    },
  );
  const starters = spotlight.categories.flatMap((category) => {
    const scenario = category.scenarios[0];
    if (!scenario?.prompt.trim()) return [];
    return [{
      id: scenario.id ?? starterId(category.id, 0),
      title: category.title,
      description: category.description,
      prompt: scenario.prompt,
      icon: category.icon,
    }];
  });
  return {
    headline: spotlight.headline,
    tagline: spotlight.tagline,
    starters: starters.slice(0, 3),
  };
}
