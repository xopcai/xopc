export interface XopcWelcomeRecommendationTemplate {
  title: string;
  prompt: string;
  reason: string;
}

export interface XopcWelcomeRecommendations {
  projectBlocked: XopcWelcomeRecommendationTemplate;
  projectFailure: XopcWelcomeRecommendationTemplate;
  projectNextAction: XopcWelcomeRecommendationTemplate;
  taskAttention: XopcWelcomeRecommendationTemplate;
  taskFailure: XopcWelcomeRecommendationTemplate;
  taskReview: XopcWelcomeRecommendationTemplate;
  taskClosed: XopcWelcomeRecommendationTemplate;
  taskNextAction: XopcWelcomeRecommendationTemplate;
}

export interface XopcWelcomeCopy {
  headline: string;
  acceptSuggestionHint: string;
  recommendations: XopcWelcomeRecommendations;
}

export interface XopcWelcomeData {
  copy: XopcWelcomeCopy;
}

export interface XopcWelcomeContext {
  kind: string;
  projectName?: string;
  taskTitle?: string;
  phase?: string;
  operationalState?: string;
  attentionSummary?: string;
  nextAction?: string;
  recentFailure?: string;
  blockedReason?: string;
  recommendedAction?: string;
}

export interface XopcWelcomeRecommendation {
  id: string;
  title: string;
  prompt: string;
  reason: string;
}

export interface XopcWelcomeModel {
  headline: string;
  recommendation?: XopcWelcomeRecommendation;
}

function fillWelcome(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{(\w+)}}/g, (_match: string, key: string): string => vars[key]?.trim() ?? '')
    .replace(/[ \t]{2,}/g, ' ').trim();
}

function recommendation(id: string, template: XopcWelcomeRecommendationTemplate,
  vars: Record<string, string | undefined>): XopcWelcomeRecommendation {
  return {
    id,
    title: fillWelcome(template.title, vars),
    prompt: fillWelcome(template.prompt, vars),
    reason: fillWelcome(template.reason, vars)
  };
}

function projectRecommendation(context: XopcWelcomeContext,
  copy: XopcWelcomeCopy): XopcWelcomeRecommendation | undefined {
  const vars: Record<string, string | undefined> = {
    'projectName': context.projectName,
    'blockedReason': context.blockedReason,
    'recentFailure': context.recentFailure,
    'nextAction': context.recommendedAction
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

function taskRecommendation(context: XopcWelcomeContext,
  copy: XopcWelcomeCopy): XopcWelcomeRecommendation | undefined {
  const vars: Record<string, string | undefined> = {
    'taskTitle': context.taskTitle,
    'attentionSummary': context.attentionSummary,
    'recentFailure': context.recentFailure,
    'nextAction': context.nextAction
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

export function buildChatWelcome(context: XopcWelcomeContext, copy: XopcWelcomeCopy): XopcWelcomeModel {
  let next: XopcWelcomeRecommendation | undefined;
  if (context.kind === 'project') next = projectRecommendation(context, copy);
  else if (context.kind === 'task') next = taskRecommendation(context, copy);
  return { headline: copy.headline, recommendation: next };
}
