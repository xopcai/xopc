export type WelcomeSuggestionContext =
  | { kind: 'empty' }
  | {
      kind: 'codingProject';
      projectId: string;
      projectName: string;
      workspaceRoot?: string;
      recommendedAction?: string;
      blockedReason?: string;
      recentFailure?: string;
    }
  | {
      kind: 'generalProject';
      projectId: string;
      projectName: string;
      recommendedAction?: string;
      blockedReason?: string;
      recentFailure?: string;
    }
  | {
      kind: 'note';
      noteId: string;
      title: string;
      projectId?: string | null;
    }
  | {
      kind: 'workingDirectory';
      path: string;
    }
  | {
      kind: 'codingWorkspace';
      path: string;
    }
  | {
      kind: 'task';
      taskId: string;
      taskTitle: string;
      phase: 'backlog' | 'ready' | 'active' | 'review' | 'closed';
      operationalState: 'idle' | 'queued' | 'running' | 'waiting' | 'verifying' | 'blocked';
      attentionSummary?: string;
      nextAction?: string;
      recentFailure?: string;
    }
  | {
      kind: 'file';
      fileName: string;
    }
  | {
      kind: 'workflow';
      workflowName: string;
      status?: string;
      nextAction?: string;
      recentFailure?: string;
    };

export type WelcomeSuggestionContextStatus = 'loading' | 'ready' | 'degraded';

export type WelcomeSuggestionScenario = {
  id?: string;
  prompt: string;
};

export type WelcomeSuggestionCard = {
  id: string;
  icon: string;
  title: string;
  description: string;
  scenarios: WelcomeSuggestionScenario[];
  scope?: 'context' | 'explore';
};

export type WelcomeRecommendation = {
  id: string;
  categoryId: string;
  icon: string;
  title: string;
  prompt: string;
  reason: string;
};

export type WelcomeSuggestionSelection = {
  suggestionId: string;
  categoryId: string;
  contextKind: WelcomeSuggestionContext['kind'];
  prompt: string;
};

export type WelcomeSpotlightModel = {
  headline: string;
  tagline: string;
  contextLabel?: string;
  contextKind: WelcomeSuggestionContext['kind'];
  contextStatus: WelcomeSuggestionContextStatus;
  statusLabel?: string;
  retryLabel: string;
  refreshExplorationLabel: string;
  otherSuggestionsLabel: string;
  primaryRecommendation: WelcomeRecommendation;
  categories: WelcomeSuggestionCard[];
};

export type WelcomeSuggestionAgent = {
  id: string;
  name?: string;
  description?: string;
  role?: string;
  responsibilities?: string[];
  skills?: string[];
};

export type WelcomeSuggestionAgentKind = 'general' | 'coding' | 'writing' | 'research' | 'data' | 'creative';

export type WelcomeSuggestionBuildOptions = {
  affinity?: Record<string, number>;
  contextStatus?: WelcomeSuggestionContextStatus;
  explorationSeed?: string;
  explorationOffset?: number;
};

type SpotlightTemplate = {
  headline: string;
  tagline: string;
  contextLabel?: string;
  categories: WelcomeSuggestionCard[];
};

export type WelcomeSpotlightCopy = {
  otherSuggestionsLabel: string;
  acceptSuggestionHint?: string;
  refreshExplorationLabel: string;
  contextLoading: string;
  contextFallback: string;
  retryContext: string;
  contextFallbackTitle: string;
  agentTagline: string;
  reasons: {
    general: string;
    agent: string;
    project: string;
    note: string;
    directory: string;
  };
  contextPrompts: {
    codingWorkspace: string;
    projectBlocked: string;
    projectNextAction: string;
    projectFailure: string;
    taskAttention: string;
    taskNextAction: string;
    taskFailure: string;
    taskReview: string;
    taskClosed: string;
    fileStart: string;
    workflowNextAction: string;
    workflowFailure: string;
  };
  exploreCards: WelcomeSuggestionCard[];
  agentCards: Partial<Record<WelcomeSuggestionAgentKind, WelcomeSuggestionCard>>;
  empty: SpotlightTemplate;
  codingProject: SpotlightTemplate;
  codingWorkspace: SpotlightTemplate;
  generalProject: SpotlightTemplate;
  note: SpotlightTemplate;
  workingDirectory: SpotlightTemplate;
  task: SpotlightTemplate;
  file: SpotlightTemplate;
  workflow: SpotlightTemplate;
};

type RankedCandidate = WelcomeRecommendation & {
  category: WelcomeSuggestionCard;
  score: number;
};

const BUILTIN_AGENT_KIND: Record<string, WelcomeSuggestionAgentKind> = {
  main: 'general',
  coder: 'coding',
  writer: 'writing',
  researcher: 'research',
  'data-analyst': 'data',
  creative: 'creative',
};

function fillTemplate(template: string | undefined, vars: Record<string, string | undefined>): string | undefined {
  if (!template) return undefined;
  return template
    .replace(/\{\{(\w+)}}/g, (_, key: string) => vars[key]?.trim() ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function fillSpotlightTemplate(template: SpotlightTemplate, vars: Record<string, string | undefined>): SpotlightTemplate {
  return {
    headline: fillTemplate(template.headline, vars) ?? template.headline,
    tagline: fillTemplate(template.tagline, vars) ?? template.tagline,
    contextLabel: fillTemplate(template.contextLabel, vars),
    categories: template.categories.map((category) => ({
      ...category,
      title: fillTemplate(category.title, vars) ?? category.title,
      description: fillTemplate(category.description, vars) ?? category.description,
      scenarios: category.scenarios.map((scenario, index) => ({
        id: scenario.id ?? `${category.id}:${index}`,
        prompt: fillTemplate(scenario.prompt, vars) ?? scenario.prompt,
      })),
    })),
  };
}

function inferAgentKind(agent: WelcomeSuggestionAgent | undefined): WelcomeSuggestionAgentKind {
  const id = agent?.id.trim().toLowerCase() ?? '';
  if (BUILTIN_AGENT_KIND[id]) return BUILTIN_AGENT_KIND[id];

  const text = [
    agent?.id,
    agent?.name,
    agent?.description,
    agent?.role,
    ...(agent?.responsibilities ?? []),
    ...(agent?.skills ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\b(code|coder|coding|developer|engineer|debug|refactor|test|review|software)\b|编程|代码|开发|工程|调试|测试|审查|重构|软件/.test(text)) return 'coding';
  if (/\b(write|writer|writing|draft|edit|rewrite|copy|content|translate)\b|写作|文案|编辑|改写|翻译|内容|撰写/.test(text)) return 'writing';
  if (/\b(research|researcher|search|source|fact|synthesis|investigate|investigation)\b|调研|研究|搜索|检索|核查|资料|事实|来源|综合/.test(text)) return 'research';
  if (/\b(data|analysis|analyst|csv|sql|metric|visuali[sz]ation|report)\b|数据|分析|报表|指标|可视化|统计/.test(text)) return 'data';
  if (/\b(creative|design|visual|image|story|brainstorm|ideation)\b|创意|设计|视觉|图像|故事|头脑风暴|构思/.test(text)) return 'creative';
  return 'general';
}

function contextTitle(context: WelcomeSuggestionContext): string {
  switch (context.kind) {
    case 'codingProject':
    case 'generalProject':
      return context.projectName;
    case 'note':
      return context.title;
    case 'workingDirectory':
    case 'codingWorkspace':
      return context.path;
    case 'task':
      return context.taskTitle;
    case 'file':
      return context.fileName;
    case 'workflow':
      return context.workflowName;
    case 'empty':
    default:
      return '';
  }
}

function contextReason(
  context: WelcomeSuggestionContext,
  copy: WelcomeSpotlightCopy,
  agentName: string,
  usesAgentCard: boolean,
): string {
  if (usesAgentCard && agentName) {
    return fillTemplate(copy.reasons.agent, { agentName }) ?? copy.reasons.general;
  }
  switch (context.kind) {
    case 'codingProject':
    case 'generalProject':
      return fillTemplate(copy.reasons.project, { projectName: context.projectName }) ?? copy.reasons.general;
    case 'note':
      return fillTemplate(copy.reasons.note, { noteTitle: context.title }) ?? copy.reasons.general;
    case 'workingDirectory':
    case 'codingWorkspace':
      return fillTemplate(copy.reasons.directory, { path: context.path }) ?? copy.reasons.general;
    case 'task':
    case 'file':
    case 'workflow':
      return copy.reasons.general;
    case 'empty':
    default:
      return agentName
        ? (fillTemplate(copy.reasons.agent, { agentName }) ?? copy.reasons.general)
        : copy.reasons.general;
  }
}

function dynamicContextCandidate(
  context: WelcomeSuggestionContext,
  categories: WelcomeSuggestionCard[],
  copy: WelcomeSpotlightCopy,
): RankedCandidate | null {
  let categoryId = '';
  let promptTemplate = '';
  let vars: Record<string, string | undefined> = {};

  if (context.kind === 'codingProject' && context.workspaceRoot?.trim()) {
    categoryId = 'understand-codebase';
    promptTemplate = copy.contextPrompts.codingWorkspace;
    vars = { projectName: context.projectName, workspaceRoot: context.workspaceRoot };
  }

  if (
    (context.kind === 'codingProject' || context.kind === 'generalProject') &&
    context.blockedReason?.trim()
  ) {
    categoryId = context.kind === 'codingProject' ? 'review-debug' : 'project-status';
    promptTemplate = copy.contextPrompts.projectBlocked;
    vars = { projectName: context.projectName, blockedReason: context.blockedReason };
  } else if (
    (context.kind === 'codingProject' || context.kind === 'generalProject') &&
    context.recentFailure?.trim()
  ) {
    categoryId = context.kind === 'codingProject' ? 'review-debug' : 'project-status';
    promptTemplate = copy.contextPrompts.projectFailure;
    vars = { projectName: context.projectName, recentFailure: context.recentFailure };
  } else if (
    (context.kind === 'codingProject' || context.kind === 'generalProject') &&
    context.recommendedAction?.trim()
  ) {
    categoryId = context.kind === 'codingProject' ? 'implement-feature' : 'project-next-step';
    promptTemplate = copy.contextPrompts.projectNextAction;
    vars = { projectName: context.projectName, nextAction: context.recommendedAction };
  }

  if (context.kind === 'task') {
    vars = { taskTitle: context.taskTitle };
    if (context.attentionSummary?.trim()) {
      categoryId = 'task-clarify';
      promptTemplate = copy.contextPrompts.taskAttention;
      vars.attentionSummary = context.attentionSummary;
    } else if (context.recentFailure?.trim()) {
      categoryId = 'task-recover';
      promptTemplate = copy.contextPrompts.taskFailure;
      vars.recentFailure = context.recentFailure;
    } else if (context.phase === 'review' || context.operationalState === 'verifying') {
      categoryId = 'task-verify';
      promptTemplate = copy.contextPrompts.taskReview;
    } else if (context.phase === 'closed') {
      categoryId = 'task-verify';
      promptTemplate = copy.contextPrompts.taskClosed;
    } else if (context.nextAction?.trim()) {
      categoryId = 'task-next-step';
      promptTemplate = copy.contextPrompts.taskNextAction;
      vars.nextAction = context.nextAction;
    }
  }

  if (context.kind === 'file') {
    categoryId = 'file-edit';
    promptTemplate = copy.contextPrompts.fileStart;
    vars = { fileName: context.fileName };
  }

  if (context.kind === 'workflow') {
    vars = { workflowName: context.workflowName };
    if (context.recentFailure?.trim()) {
      categoryId = 'workflow-recover';
      promptTemplate = copy.contextPrompts.workflowFailure;
      vars.recentFailure = context.recentFailure;
    } else if (context.nextAction?.trim()) {
      categoryId = 'workflow-next-step';
      promptTemplate = copy.contextPrompts.workflowNextAction;
      vars.nextAction = context.nextAction;
    }
  }

  if (!categoryId || !promptTemplate) return null;
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return null;
  return {
    id: `context:${categoryId}`,
    categoryId,
    category,
    icon: category.icon,
    title: category.title,
    prompt: fillTemplate(promptTemplate, vars) ?? promptTemplate,
    reason: '',
    score: 300,
  };
}

function candidateContextBoost(context: WelcomeSuggestionContext, categoryId: string): number {
  switch (context.kind) {
    case 'codingProject':
      return categoryId === 'understand-codebase' ? 45 : categoryId === 'implement-feature' ? 30 : 20;
    case 'codingWorkspace':
      return categoryId === 'directory-understand' ? 45 : categoryId === 'directory-entry' ? 30 : 20;
    case 'generalProject':
      return categoryId === 'project-next-step' ? 40 : 25;
    case 'note':
      return categoryId === 'note-summarize' ? 40 : 25;
    case 'workingDirectory':
      return categoryId === 'directory-understand' ? 40 : 25;
    case 'task':
      if (context.attentionSummary) return categoryId === 'task-clarify' ? 60 : 20;
      if (context.recentFailure) return categoryId === 'task-recover' ? 60 : 20;
      if (context.phase === 'review' || context.phase === 'closed') return categoryId === 'task-verify' ? 55 : 20;
      return categoryId === 'task-next-step' ? 45 : 25;
    case 'file':
      return categoryId === 'file-edit' ? 45 : 25;
    case 'workflow':
      if (context.recentFailure) return categoryId === 'workflow-recover' ? 50 : 20;
      if (context.status === 'succeeded') return categoryId === 'workflow-review' ? 45 : 20;
      return categoryId === 'workflow-next-step' ? 40 : 20;
    case 'empty':
    default:
      return 0;
  }
}

function rankCandidates(
  categories: WelcomeSuggestionCard[],
  context: WelcomeSuggestionContext,
  agentCategoryId: string | null,
  affinity: Record<string, number>,
  copy: WelcomeSpotlightCopy,
): RankedCandidate[] {
  const candidates = categories.flatMap((category, categoryIndex) =>
    category.scenarios.map((scenario, scenarioIndex): RankedCandidate => {
      const id = scenario.id ?? `${category.id}:${scenarioIndex}`;
      const affinityBoost = Math.min(35, Math.max(0, affinity[id] ?? 0));
      const agentBoost = category.id === agentCategoryId ? (context.kind === 'empty' ? 55 : 20) : 0;
      return {
        id,
        categoryId: category.id,
        category,
        icon: category.icon,
        title: category.title,
        prompt: scenario.prompt,
        reason: '',
        score: 100 - categoryIndex * 8 - scenarioIndex + candidateContextBoost(context, category.id) + agentBoost + affinityBoost,
      };
    }),
  );
  const dynamic = dynamicContextCandidate(context, categories, copy);
  if (dynamic) candidates.push(dynamic);

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const key = candidate.prompt.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function explorationCardAffinity(card: WelcomeSuggestionCard, affinity: Record<string, number>): number {
  return Math.max(0, ...card.scenarios.map((scenario, index) => affinity[scenario.id ?? `${card.id}:${index}`] ?? 0));
}

function selectExplorationCard(
  copy: WelcomeSpotlightCopy,
  affinity: Record<string, number>,
  seed: string,
  offset: number,
): WelcomeSuggestionCard {
  const cards = fillSpotlightTemplate(
    { headline: '', tagline: '', categories: copy.exploreCards },
    {},
  ).categories.map((card) => ({ ...card, scope: 'explore' as const }));
  if (cards.length === 0) {
    throw new Error('Welcome spotlight requires at least one exploration card');
  }

  const baseIndex = hashSeed(seed) % cards.length;
  if (offset > 0) return cards[(baseIndex + offset) % cards.length] ?? cards[0];

  const preferred = cards
    .map((card, index) => ({ card, index, score: explorationCardAffinity(card, affinity) }))
    .sort((a, b) => b.score - a.score || Math.abs(a.index - baseIndex) - Math.abs(b.index - baseIndex))[0];
  return preferred && preferred.score > 0 ? preferred.card : (cards[baseIndex] ?? cards[0]);
}

function isCodingWorkspaceContext(context: WelcomeSuggestionContext): boolean {
  return context.kind === 'codingProject' || context.kind === 'codingWorkspace';
}

function includesExploration(context: WelcomeSuggestionContext): boolean {
  return (
    context.kind === 'empty' ||
    context.kind === 'note' ||
    context.kind === 'workingDirectory' ||
    context.kind === 'codingWorkspace'
  );
}

export function buildWelcomeSpotlight(
  context: WelcomeSuggestionContext,
  copy: WelcomeSpotlightCopy,
  agent?: WelcomeSuggestionAgent,
  options: WelcomeSuggestionBuildOptions = {},
): WelcomeSpotlightModel {
  let template: SpotlightTemplate;
  const vars: Record<string, string | undefined> = {};
  switch (context.kind) {
    case 'codingProject':
      template = copy.codingProject;
      vars.projectName = context.projectName;
      vars.workspaceRoot = context.workspaceRoot;
      break;
    case 'codingWorkspace':
      template = copy.codingWorkspace;
      vars.path = context.path;
      break;
    case 'generalProject':
      template = copy.generalProject;
      vars.projectName = context.projectName;
      break;
    case 'note':
      template = copy.note;
      vars.noteTitle = context.title;
      break;
    case 'workingDirectory':
      template = copy.workingDirectory;
      vars.path = context.path;
      break;
    case 'task':
      template = copy.task;
      vars.taskTitle = context.taskTitle;
      break;
    case 'file':
      template = copy.file;
      vars.fileName = context.fileName;
      break;
    case 'workflow':
      template = copy.workflow;
      vars.workflowName = context.workflowName;
      break;
    case 'empty':
    default:
      template = copy.empty;
      break;
  }

  const base = fillSpotlightTemplate(template, vars);
  const agentKind = inferAgentKind(agent);
  const agentName = agent?.name?.trim() || agent?.id.trim() || '';
  const contextName = contextTitle(context) || copy.contextFallbackTitle;
  let agentCategoryId: string | null = null;
  const categories = [...base.categories];
  const canAddAgentCard =
    agentKind !== 'general' &&
    !isCodingWorkspaceContext(context) &&
    (agentKind !== 'coding' || context.kind === 'empty');
  if (canAddAgentCard) {
    const agentTemplate = copy.agentCards[agentKind];
    if (agentTemplate) {
      const [agentCard] = fillSpotlightTemplate(
        { headline: base.headline, tagline: base.tagline, categories: [agentTemplate] },
        { agentName, contextTitle: contextName },
      ).categories;
      if (agentCard && !categories.some((category) => category.id === agentCard.id)) {
        categories.push(agentCard);
        agentCategoryId = agentCard.id;
      }
    }
  }

  const ranked = rankCandidates(categories, context, agentCategoryId, options.affinity ?? {}, copy);
  const primary = ranked[0];
  if (!primary) {
    throw new Error('Welcome spotlight requires at least one suggestion');
  }
  const reason = contextReason(context, copy, agentName, primary.categoryId === agentCategoryId);
  const displayCategories = categories.map((category) => {
    if (!primary.id.startsWith('context:') || category.id !== primary.categoryId) return category;
    return {
      ...category,
      scenarios: [
        { id: primary.id, prompt: primary.prompt },
        ...category.scenarios.filter((scenario) => scenario.prompt !== primary.prompt),
      ],
    };
  });

  const categoryScores = new Map<string, number>();
  for (const candidate of ranked) {
    categoryScores.set(candidate.categoryId, Math.max(categoryScores.get(candidate.categoryId) ?? 0, candidate.score));
  }
  const contextCategories = (context.kind === 'empty'
    ? displayCategories.filter((category) => category.id !== 'research')
    : displayCategories
  )
    .filter((category) => category.scenarios.length > 0)
    .sort((a, b) => (categoryScores.get(b.id) ?? 0) - (categoryScores.get(a.id) ?? 0))
    .slice(0, includesExploration(context) ? 2 : 3)
    .map((category) => ({ ...category, scope: 'context' as const }));
  const explorationCard = includesExploration(context)
    ? selectExplorationCard(
        copy,
        options.affinity ?? {},
        options.explorationSeed ?? 'default',
        Math.max(0, options.explorationOffset ?? 0),
      )
    : null;

  const contextStatus = options.contextStatus ?? 'ready';
  return {
    ...base,
    contextKind: context.kind,
    tagline:
      agentName && agentKind !== 'general'
        ? (fillTemplate(copy.agentTagline, { agentName }) ?? base.tagline)
        : base.tagline,
    contextStatus,
    statusLabel:
      contextStatus === 'loading'
        ? copy.contextLoading
        : contextStatus === 'degraded'
          ? copy.contextFallback
          : undefined,
    retryLabel: copy.retryContext,
    refreshExplorationLabel: copy.refreshExplorationLabel,
    otherSuggestionsLabel: copy.otherSuggestionsLabel,
    primaryRecommendation: {
      id: primary.id,
      categoryId: primary.categoryId,
      icon: primary.icon,
      title: primary.title,
      prompt: primary.prompt,
      reason,
    },
    categories: explorationCard ? [...contextCategories, explorationCard] : contextCategories,
  };
}
