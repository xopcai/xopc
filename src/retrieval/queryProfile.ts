import {
  extractCjkBigrams,
  extractLexicalTerms,
  extractRetrievalIdentifiers,
  normalizeRetrievalText,
} from './textFeatures.js';

export type RetrievalTimeHint = 'current' | 'recent' | 'historical' | 'future';

export interface RetrievalScope {
  sessionKey?: string;
  workspaceId?: string;
  projectId?: string;
}

export interface RetrievalQueryProfile {
  normalized: string;
  terms: string[];
  cjkBigrams: string[];
  identifiers: string[];
  intentKinds: string[];
  timeHints: RetrievalTimeHint[];
  scope: RetrievalScope;
}

const INTENT_RULES: Array<{ kinds: string[]; pattern: RegExp }> = [
  {
    kinds: ['boundary'],
    pattern: /\b(?:avoid|never|permission|confirm|approval)\b|不要|禁止|避免|确认|授权|边界/i,
  },
  {
    kinds: ['preference', 'tool_preference'],
    pattern: /\b(?:prefer|preference|format|language|style)\b|喜欢|偏好|格式|语言|风格|简洁|详细/i,
  },
  {
    kinds: ['project_context', 'workspace_fact', 'task_lesson'],
    pattern: /\b(?:project|repository|repo|workspace|codebase|deploy|release)\b|项目|仓库|代码库|工作区|发布|部署/i,
  },
  {
    kinds: ['long_term_goal', 'commitment'],
    pattern: /\b(?:goal|plan|deadline|commitment)\b|目标|计划|截止|承诺/i,
  },
  {
    kinds: ['routine'],
    pattern: /\b(?:routine|usually|weekly|daily|every time)\b|习惯|通常|每周|每天|每次/i,
  },
  {
    kinds: ['relationship'],
    pattern: /\b(?:person|people|colleague|collaborator|relationship)\b|同事|合作伙伴|关系|联系人/i,
  },
];

const TIME_RULES: Array<{ hint: RetrievalTimeHint; pattern: RegExp }> = [
  { hint: 'current', pattern: /\b(?:now|current|today)\b|现在|当前|今天/i },
  { hint: 'recent', pattern: /\b(?:recent|recently|latest)\b|最近|近期|最新/i },
  { hint: 'historical', pattern: /\b(?:previous|before|history|last time)\b|之前|以前|历史|上次/i },
  { hint: 'future', pattern: /\b(?:future|next|later|upcoming)\b|未来|下次|之后|即将/i },
];

export function buildRetrievalQueryProfile(
  query: string,
  scope: RetrievalScope = {},
): RetrievalQueryProfile {
  const normalized = normalizeRetrievalText(query);
  const intentKinds = INTENT_RULES
    .filter((rule) => rule.pattern.test(normalized))
    .flatMap((rule) => rule.kinds);
  const timeHints = TIME_RULES
    .filter((rule) => rule.pattern.test(normalized))
    .map((rule) => rule.hint);
  return {
    normalized,
    terms: extractLexicalTerms(normalized),
    cjkBigrams: extractCjkBigrams(normalized),
    identifiers: extractRetrievalIdentifiers(normalized),
    intentKinds: [...new Set(intentKinds)],
    timeHints: [...new Set(timeHints)],
    scope: { ...scope },
  };
}
