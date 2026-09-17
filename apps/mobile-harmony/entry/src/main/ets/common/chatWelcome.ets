export interface XopcWelcomeScenario { id?: string; prompt: string; }
export interface XopcWelcomeCard { id: string; title: string; description: string; icon: string; scenarios: XopcWelcomeScenario[]; }
export interface XopcWelcomeTemplate { headline: string; tagline: string; categories: XopcWelcomeCard[]; }
export interface XopcWelcomeCopy {
  empty: XopcWelcomeTemplate; generalProject: XopcWelcomeTemplate; task: XopcWelcomeTemplate; workingDirectory: XopcWelcomeTemplate;
  exploreCards: XopcWelcomeCard[]; agentCards: Record<string, XopcWelcomeCard>; agentTagline: string; contextFallbackTitle: string;
  contextPrompts: Record<string, string>; contextFallback: string; retryContext: string;
}
export interface XopcWelcomeName { name: string; description: string; }
export interface XopcWelcomeData { copy: XopcWelcomeCopy; names: Record<string, XopcWelcomeName>; }
export interface XopcWelcomeContext {
  kind: string; projectName?: string; taskTitle?: string; path?: string; phase?: string; operationalState?: string;
  attentionSummary?: string; nextAction?: string; recentFailure?: string; blockedReason?: string; recommendedAction?: string;
}
export interface XopcWelcomeAgent { id: string; name?: string; description?: string; skills?: string[]; }
export interface XopcWelcomeStarter { id: string; title: string; description: string; prompt: string; icon: string; }
export interface XopcWelcomeModel { headline: string; tagline: string; starters: XopcWelcomeStarter[]; }
interface XopcWelcomeRanked { card: XopcWelcomeCard; score: number; }

function fillWelcome(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{(\w+)}}/g, (_match: string, key: string): string => vars[key]?.trim() ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}
function fillCard(card: XopcWelcomeCard, vars: Record<string, string | undefined>): XopcWelcomeCard {
  return { id: card.id, title: fillWelcome(card.title, vars), description: fillWelcome(card.description, vars), icon: card.icon,
    scenarios: card.scenarios.map((scenario: XopcWelcomeScenario, index: number): XopcWelcomeScenario => ({ id: scenario.id ?? card.id + ':' + index, prompt: fillWelcome(scenario.prompt, vars) })) };
}
function welcomeAgentKind(agent: XopcWelcomeAgent): string {
  const builtins: Record<string, string> = { 'main': 'general', 'coder': 'coding', 'writer': 'writing', 'researcher': 'research', 'data-analyst': 'data', 'creative': 'creative' };
  if (builtins[agent.id.trim().toLowerCase()]) return builtins[agent.id.trim().toLowerCase()];
  const text = [agent.id, agent.name || '', agent.description || ''].concat(agent.skills || []).join(' ').toLowerCase();
  if (/\b(code|coder|coding|developer|engineer|debug|refactor|test|review|software)\b|编程|代码|开发|工程|调试|测试|审查|重构|软件/.test(text)) return 'coding';
  if (/\b(write|writer|writing|draft|edit|rewrite|copy|content|translate)\b|写作|文案|编辑|改写|翻译|内容|撰写/.test(text)) return 'writing';
  if (/\b(research|researcher|search|source|fact|synthesis|investigate|investigation)\b|调研|研究|搜索|检索|核查|资料|事实|来源|综合/.test(text)) return 'research';
  if (/\b(data|analysis|analyst|csv|sql|metric|visuali[sz]ation|report)\b|数据|分析|报表|指标|可视化|统计/.test(text)) return 'data';
  if (/\b(creative|design|visual|image|story|brainstorm|ideation)\b|创意|设计|视觉|图像|故事|头脑风暴|构思/.test(text)) return 'creative';
  return 'general';
}
export function welcomeAgentName(agent: XopcWelcomeAgent, data: XopcWelcomeData): string {
  const defaults: Record<string, string[]> = { 'main': ['main', 'smart assistant'], 'coder': ['coder', 'coding expert'],
    'writer': ['writer', 'writing assistant'], 'researcher': ['researcher', 'research assistant'],
    'data-analyst': ['data-analyst', 'data analyst'], 'creative': ['creative', 'creative assistant'] };
  const keys: Record<string, string> = { 'main': 'assistant', 'coder': 'coding', 'writer': 'writing', 'researcher': 'research', 'data-analyst': 'data', 'creative': 'creative' };
  const id = agent.id.trim().toLowerCase(); const name = agent.name?.trim() ?? '';
  return defaults[id] && (!name || defaults[id].includes(name.toLowerCase())) ? data.names[keys[id]]?.name || agent.id : name || agent.id;
}
function contextBoost(context: XopcWelcomeContext, id: string): number {
  if (context.kind === 'generalProject') return id === 'project-next-step' ? 40 : 25;
  if (context.kind === 'workingDirectory') return id === 'directory-understand' ? 40 : 25;
  if (context.kind === 'task') {
    if (context.attentionSummary) return id === 'task-clarify' ? 60 : 20;
    if (context.recentFailure) return id === 'task-recover' ? 60 : 20;
    if (context.phase === 'review' || context.phase === 'closed') return id === 'task-verify' ? 55 : 20;
    return id === 'task-next-step' ? 45 : 25;
  }
  return 0;
}

// Same mobile projection as buildMobileWelcomeModel; parity tests exercise the shared ranker.
export function buildChatWelcome(context: XopcWelcomeContext, copy: XopcWelcomeCopy, agent: XopcWelcomeAgent, seed: string): XopcWelcomeModel {
  const template = context.kind === 'task' ? copy.task : context.kind === 'generalProject' ? copy.generalProject
    : context.kind === 'workingDirectory' ? copy.workingDirectory : copy.empty;
  const vars: Record<string, string | undefined> = { 'projectName': context.projectName, 'taskTitle': context.taskTitle, 'path': context.path };
  const categories = template.categories.map((card: XopcWelcomeCard): XopcWelcomeCard => fillCard(card, vars));
  const kind = welcomeAgentKind(agent); const agentName = agent.name?.trim() || agent.id.trim(); let agentCardId = '';
  if (kind !== 'general' && (kind !== 'coding' || context.kind === 'empty') && copy.agentCards[kind]) {
    const card = fillCard(copy.agentCards[kind], { 'agentName': agentName, 'contextTitle': context.projectName || context.taskTitle || context.path || copy.contextFallbackTitle });
    if (!categories.some((entry: XopcWelcomeCard): boolean => entry.id === card.id)) { categories.push(card); agentCardId = card.id; }
  }
  let dynamicId = ''; let promptKey = '';
  const promptVars: Record<string, string | undefined> = { 'projectName': context.projectName, 'taskTitle': context.taskTitle,
    'attentionSummary': context.attentionSummary, 'recentFailure': context.recentFailure, 'blockedReason': context.blockedReason, 'nextAction': context.nextAction || context.recommendedAction };
  if (context.kind === 'generalProject') {
    if (context.blockedReason?.trim()) { dynamicId = 'project-status'; promptKey = 'projectBlocked'; }
    else if (context.recentFailure?.trim()) { dynamicId = 'project-status'; promptKey = 'projectFailure'; }
    else if (context.recommendedAction?.trim()) { dynamicId = 'project-next-step'; promptKey = 'projectNextAction'; }
  } else if (context.kind === 'task') {
    if (context.attentionSummary?.trim()) { dynamicId = 'task-clarify'; promptKey = 'taskAttention'; }
    else if (context.recentFailure?.trim()) { dynamicId = 'task-recover'; promptKey = 'taskFailure'; }
    else if (context.phase === 'review' || context.operationalState === 'verifying') { dynamicId = 'task-verify'; promptKey = 'taskReview'; }
    else if (context.phase === 'closed') { dynamicId = 'task-verify'; promptKey = 'taskClosed'; }
    else if (context.nextAction?.trim()) { dynamicId = 'task-next-step'; promptKey = 'taskNextAction'; }
  }
  const ranked = categories.map((card: XopcWelcomeCard, index: number): XopcWelcomeRanked => {
    let score = 100 - index * 8 + contextBoost(context, card.id) + (card.id === agentCardId ? (context.kind === 'empty' ? 55 : 20) : 0);
    if (card.id === dynamicId && copy.contextPrompts[promptKey]) {
      const prompt = fillWelcome(copy.contextPrompts[promptKey], promptVars);
      const dynamic: XopcWelcomeScenario = { id: 'context:' + card.id, prompt };
      card.scenarios = [dynamic].concat(card.scenarios.filter((scenario: XopcWelcomeScenario): boolean => scenario.prompt !== prompt)); score = 300;
    }
    return { card, score };
  }).filter((item: XopcWelcomeRanked): boolean => item.card.scenarios.length > 0 && !(context.kind === 'empty' && item.card.id === 'research'));
  const exploration = context.kind === 'empty' || context.kind === 'workingDirectory';
  const selected = ranked.sort((left: XopcWelcomeRanked, right: XopcWelcomeRanked): number => right.score - left.score).slice(0, exploration ? 2 : 3)
    .map((item: XopcWelcomeRanked): XopcWelcomeCard => item.card);
  if (exploration && copy.exploreCards.length) {
    let hash = 0; for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const preferred = context.kind === 'empty' ? copy.exploreCards.find((card: XopcWelcomeCard): boolean => card.id === 'explore-ai-news') : undefined;
    selected.push(fillCard(preferred ?? copy.exploreCards[hash % copy.exploreCards.length], {}));
  }
  return { headline: fillWelcome(template.headline, vars), tagline: kind !== 'general' && agentName
    ? fillWelcome(copy.agentTagline, { 'agentName': agentName }) : fillWelcome(template.tagline, vars),
    starters: selected.filter((card: XopcWelcomeCard): boolean => !!card.scenarios[0]?.prompt.trim()).map((card: XopcWelcomeCard): XopcWelcomeStarter => ({
      id: card.scenarios[0].id ?? card.id + ':0', title: card.title, description: card.description, icon: card.icon, prompt: card.scenarios[0].prompt
    })).slice(0, 3) };
}
