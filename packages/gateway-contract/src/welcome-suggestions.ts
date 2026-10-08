import type { TaskOperationalState } from './task-lifecycle.js';

export type WelcomeSuggestionContext =
  | { kind: 'empty' }
  | {
      kind: 'project';
      projectId: string;
      projectName: string;
      recommendedAction?: string;
      blockedReason?: string;
      recentFailure?: string;
    }
  | {
      kind: 'task';
      taskId: string;
      taskTitle: string;
      phase: 'backlog' | 'ready' | 'active' | 'review' | 'closed';
      operationalState: TaskOperationalState;
      attentionSummary?: string;
      nextAction?: string;
      recentFailure?: string;
    }
  | {
      kind: 'workflow';
      workflowName: string;
      status?: string;
      nextAction?: string;
      recentFailure?: string;
    };

export type WelcomeSuggestionContextStatus = 'loading' | 'ready' | 'degraded';

export type WelcomeRecommendation = {
  id: string;
  title: string;
  prompt: string;
  reason: string;
};

export type WelcomeSuggestionSelection = {
  suggestionId: string;
  contextKind: WelcomeSuggestionContext['kind'];
  prompt: string;
};

export type WelcomeSpotlightModel = {
  headline: string;
  contextKind: WelcomeSuggestionContext['kind'];
  contextStatus: WelcomeSuggestionContextStatus;
  recommendation?: WelcomeRecommendation;
};

type WelcomeRecommendationTemplate = {
  title: string;
  prompt: string;
  reason: string;
};

export type WelcomeSpotlightCopy = {
  headline: string;
  projectHeadline?: string;
  acceptSuggestionHint?: string;
  recommendations: {
    projectBlocked: WelcomeRecommendationTemplate;
    projectFailure: WelcomeRecommendationTemplate;
    projectNextAction: WelcomeRecommendationTemplate;
    taskAttention: WelcomeRecommendationTemplate;
    taskFailure: WelcomeRecommendationTemplate;
    taskReview: WelcomeRecommendationTemplate;
    taskClosed: WelcomeRecommendationTemplate;
    taskNextAction: WelcomeRecommendationTemplate;
    workflowFailure: WelcomeRecommendationTemplate;
    workflowNextAction: WelcomeRecommendationTemplate;
    workflowReview: WelcomeRecommendationTemplate;
  };
};

export type WelcomeSuggestionBuildOptions = {
  contextStatus?: WelcomeSuggestionContextStatus;
};

function fillTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template
    .replace(/\{\{(\w+)}}/g, (_, key: string) => vars[key]?.trim() ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function recommendation(
  id: string,
  template: WelcomeRecommendationTemplate,
  vars: Record<string, string | undefined>,
): WelcomeRecommendation {
  return {
    id,
    title: fillTemplate(template.title, vars),
    prompt: fillTemplate(template.prompt, vars),
    reason: fillTemplate(template.reason, vars),
  };
}

function projectRecommendation(
  context: Extract<WelcomeSuggestionContext, { kind: 'project' }>,
  copy: WelcomeSpotlightCopy,
): WelcomeRecommendation | undefined {
  const vars = {
    projectName: context.projectName,
    blockedReason: context.blockedReason,
    recentFailure: context.recentFailure,
    nextAction: context.recommendedAction,
  };
  if (context.blockedReason?.trim()) {
    return recommendation('project-blocked', copy.recommendations.projectBlocked, vars);
  }
  if (context.recentFailure?.trim()) {
    return recommendation('project-failure', copy.recommendations.projectFailure, vars);
  }
  if (context.recommendedAction?.trim()) {
    return recommendation('project-next-action', copy.recommendations.projectNextAction, vars);
  }
  return undefined;
}

function taskRecommendation(
  context: Extract<WelcomeSuggestionContext, { kind: 'task' }>,
  copy: WelcomeSpotlightCopy,
): WelcomeRecommendation | undefined {
  const vars = {
    taskTitle: context.taskTitle,
    attentionSummary: context.attentionSummary,
    recentFailure: context.recentFailure,
    nextAction: context.nextAction,
  };
  if (context.attentionSummary?.trim()) {
    return recommendation('task-attention', copy.recommendations.taskAttention, vars);
  }
  if (context.recentFailure?.trim()) {
    return recommendation('task-failure', copy.recommendations.taskFailure, vars);
  }
  if (context.phase === 'review' || context.operationalState === 'verifying') {
    return recommendation('task-review', copy.recommendations.taskReview, vars);
  }
  if (context.phase === 'closed') {
    return recommendation('task-closed', copy.recommendations.taskClosed, vars);
  }
  if (context.nextAction?.trim()) {
    return recommendation('task-next-action', copy.recommendations.taskNextAction, vars);
  }
  return undefined;
}

function workflowRecommendation(
  context: Extract<WelcomeSuggestionContext, { kind: 'workflow' }>,
  copy: WelcomeSpotlightCopy,
): WelcomeRecommendation | undefined {
  const vars = {
    workflowName: context.workflowName,
    recentFailure: context.recentFailure,
    nextAction: context.nextAction,
  };
  if (context.recentFailure?.trim()) {
    return recommendation('workflow-failure', copy.recommendations.workflowFailure, vars);
  }
  if (context.nextAction?.trim()) {
    return recommendation('workflow-next-action', copy.recommendations.workflowNextAction, vars);
  }
  if (context.status === 'succeeded') {
    return recommendation('workflow-review', copy.recommendations.workflowReview, vars);
  }
  return undefined;
}

function buildRecommendation(
  context: WelcomeSuggestionContext,
  copy: WelcomeSpotlightCopy,
): WelcomeRecommendation | undefined {
  switch (context.kind) {
    case 'project':
      return projectRecommendation(context, copy);
    case 'task':
      return taskRecommendation(context, copy);
    case 'workflow':
      return workflowRecommendation(context, copy);
    case 'empty':
    default:
      return undefined;
  }
}

export function buildWelcomeSpotlight(
  context: WelcomeSuggestionContext,
  copy: WelcomeSpotlightCopy,
  options: WelcomeSuggestionBuildOptions = {},
): WelcomeSpotlightModel {
  const contextStatus = options.contextStatus ?? 'ready';
  return {
    headline: context.kind === 'project' && copy.projectHeadline
      ? fillTemplate(copy.projectHeadline, { projectName: context.projectName })
      : copy.headline,
    contextKind: context.kind,
    contextStatus,
    recommendation: contextStatus === 'ready' ? buildRecommendation(context, copy) : undefined,
  };
}
