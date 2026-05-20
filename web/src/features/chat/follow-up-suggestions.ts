import type { FollowUpContextPack } from '@/features/chat/follow-up-context';
export { followUpPromptForSuggestionId } from '@/features/chat/follow-up-prompts';
export type { FollowUpPromptLocale } from '@/features/chat/follow-up-prompts';
export {
  FOLLOW_UP_SUGGESTION_IDS,
  type FollowUpSuggestionId,
} from '@/features/chat/follow-up-suggestions.types';

import {
  FOLLOW_UP_SUGGESTION_IDS,
  type FollowUpSuggestionId,
} from '@/features/chat/follow-up-suggestions.types';
import type { Message } from '@/features/chat/messages.types';
import { buildFollowUpContextPack } from '@/features/chat/follow-up-context';

type FollowUpFamily = 'code' | 'web' | 'email' | 'date' | 'generic' | 'meta' | 'ops' | 'workflow' | 'learn';

const ALL_IDS = FOLLOW_UP_SUGGESTION_IDS;

function familyOf(id: FollowUpSuggestionId): FollowUpFamily {
  if (id.startsWith('code_')) return 'code';
  if (id.startsWith('web_') || id === 'research_deeper') return 'web';
  if (id.startsWith('email_')) return 'email';
  if (id.startsWith('date_')) return 'date';
  if (id.startsWith('learn_')) return 'learn';
  if (id.startsWith('wf_')) return 'workflow';
  if (id.startsWith('ops_')) return 'ops';
  if (id === 'what_next') return 'meta';
  return 'generic';
}

const BASE_FAMILY_MAX: Record<FollowUpFamily, number> = {
  code: 2,
  web: 2,
  email: 1,
  date: 1,
  generic: 2,
  meta: 1,
  ops: 1,
  workflow: 1,
  learn: 2,
};

type ContentSignals = {
  code: boolean;
  web: boolean;
  email: boolean;
  date: boolean;
  list: boolean;
  table: boolean;
  substantial: boolean;
};

type DerivedSignals = ContentSignals & {
  taskDebug: boolean;
  taskImplement: boolean;
  taskReview: boolean;
  taskPlan: boolean;
  taskConfig: boolean;
  taskResearch: boolean;
  taskCompare: boolean;
  taskTest: boolean;
  taskGit: boolean;
  assistantAlreadyBullets: boolean;
  assistantAlreadyTable: boolean;
  assistantAlreadyShort: boolean;
  assistantOffersOptions: boolean;
  userLangZh: boolean;
  toolsUsedWebSearch: boolean;
  toolsUsedWrite: boolean;
  toolsUsedShell: boolean;
  toolsUsedBrowser: boolean;
  anyToolError: boolean;
  taskEducational: boolean;
  hasRealCode: boolean;
};

const CODE_KEYWORD_RE =
  /\b(function|class|const |def |import |export |async |await |interface |type |public |private |protected |#include|namespace )\b/;

const CODE_KEYWORD_RE2 = /\b(return |if \(|for \(|while \(|\.map\(|\.filter\(|fn )\b/;

/** Fenced blocks or keywords that indicate actual source code — not diagram-only ``` fences. */
function detectHasRealCode(slice: string, lower: string): boolean {
  if (CODE_KEYWORD_RE.test(lower) || CODE_KEYWORD_RE2.test(lower)) return true;

  const fences = [...slice.matchAll(/```[\w-]*\n?([\s\S]*?)```/g)];
  for (const match of fences) {
    const inner = (match[1] ?? '').trim();
    if (inner.length < 4) continue;
    const innerLower = inner.toLowerCase();
    if (CODE_KEYWORD_RE.test(innerLower) || CODE_KEYWORD_RE2.test(innerLower)) return true;
    if (/[{};]/.test(inner) && /\n/.test(inner)) return true;
  }
  return false;
}

function detectEducational(slice: string, assistantText: string): boolean {
  const edu =
    /通俗|类比|简单来说|是怎么回事|是什么[？?]|工作流程|三步走|第一步|第二步|第三步|想象一下|就像.{0,12}一样|开卷考试|死记硬背|生活中的类比/i.test(
      slice,
    ) ||
    /\b(RAG|LLM|embedding|vector\s*database|retrieval[- ]augmented)\b/i.test(slice) ||
    /检索增强|向量|知识库|大模型|幻觉|开卷|闭卷|索引|嵌入/i.test(slice) ||
    /讲讲|解释一下|什么是|科普|入门|通俗/i.test(slice);

  const invitesDeeper =
    /想深入了解|深入了解|技术实现|怎么搭建|如何搭建|搭建一个|有什么想|还想了解|比如具体/i.test(
      assistantText,
    );

  return edu || invitesDeeper;
}

function detectContentSignals(slice: string, lower: string): ContentSignals {
  const code = detectHasRealCode(slice, lower);

  const web =
    /https?:\/\//i.test(slice) ||
    /\bwww\.[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b/i.test(lower) ||
    /\[[^\]]+\]\([^)]+\)/.test(slice) ||
    /\bRFC\s*\d+/i.test(slice) ||
    /\bdocs?\.[a-z0-9.-]+\.[a-z]{2,}\b/i.test(lower) ||
    /wikipedia\.org/i.test(lower) ||
    /参考文献|参考链接|资料来源|来源[:：]|\bsee also\b|\bread more\b/i.test(slice);

  const email =
    /(^|\n)\s*dear\b[\s,]/im.test(slice) ||
    /best regards|kind regards|sincerely|yours truly|yours sincerely|此致|敬礼|敬上|顺祝|商祺|尊敬的|顺颂|台安/i.test(
      slice,
    ) ||
    /(^|\n)\s*(from|to|cc|bcc)\s*:\s*\S/im.test(slice) ||
    /(^|\n)\s*subject\s*:\s*\S/im.test(slice) ||
    /(^|\n)>\s*On .+wrote:/im.test(slice) ||
    /\b(email|e-mail)\s+(to|from)\b/i.test(lower);

  const date =
    /\d{4}-\d{2}-\d{2}/.test(slice) ||
    /\d{4}年\d{1,2}月/.test(slice) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
      slice,
    ) ||
    /q[1-4]\b|\bquarter\b|本季度|上周|本周|下周|昨天|今天|明天|deadline|timeline/i.test(slice);

  const list = /^[-*•]|\n[-*•]|\n\d+\.\s/.test(slice.trim());
  const table = /\|[^\n]+\|[^\n]+\|/.test(slice);
  const substantial = slice.length > 80;

  return { code, web, email, date, list, table, substantial };
}

function cjkRatio(text: string): number {
  if (!text.length) return 0;
  let cjk = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) cjk += 1;
  }
  return cjk / text.length;
}

function detectDerived(ctx: FollowUpContextPack, content: ContentSignals): DerivedSignals {
  const combined = [ctx.userText, ctx.assistantText, ...ctx.recentUserTexts, ctx.recentAssistantSnippet]
    .filter(Boolean)
    .join('\n');
  const assistantLower = ctx.assistantText.toLowerCase();
  const userLower = ctx.userText.toLowerCase();

  const toolsUsedWebSearch = ctx.assistantToolUses.some(
    (t) => t.name === 'web_search' && t.status === 'done',
  );
  const toolsUsedWrite = ctx.assistantToolUses.some(
    (t) => (t.name === 'write_file' || t.name === 'edit_file') && t.status === 'done',
  );
  const toolsUsedShell = ctx.assistantToolUses.some((t) => t.name === 'shell');
  const toolsUsedBrowser = ctx.assistantToolUses.some(
    (t) => t.name === 'browser_use' || t.name.startsWith('browser_'),
  );
  const anyToolError = ctx.assistantToolUses.some((t) => t.status === 'error');

  const taskDebug =
    /\b(error|exception|traceback|failed|failure|panic|stack trace|typeerror|referenceerror|syntaxerror)\b/i.test(
      combined,
    ) ||
    /报错|异常|失败|错误|堆栈/.test(combined) ||
    anyToolError ||
    ctx.assistantToolUses.some((t) => /error|exit code|failed/i.test(t.resultPreview ?? ''));

  const taskImplement =
    toolsUsedWrite ||
    /\b(implement|add a|create a|write a|build a|实现|添加|写一个|新增)\b/i.test(userLower);

  const taskReview =
    /\b(review|check for issues|audit|inspect|审查|检查|看看有没有问题)\b/i.test(userLower) ||
    /\bdiff\b|pull request|\bPR\b|改动文件|代码审查/i.test(assistantLower);

  const taskEducational = detectEducational(combined, ctx.assistantText);
  const hasRealCode = detectHasRealCode(combined, combined.toLowerCase());

  const taskPlan =
    (/\b(plan|steps|how to|roadmap|计划|步骤|怎么做|方案)\b/i.test(userLower) ||
      /\n\s*\d+\.\s/.test(ctx.assistantText)) &&
    !taskEducational;

  const taskConfig =
    /xopc\.json|agents\.list|providers|gateway\.|channels\.|cron\.enabled|配置|通道|telegram|weixin/i.test(
      combined,
    );

  const taskResearch =
    toolsUsedWebSearch ||
    /\b(search|look up|find sources|资料|查一下|检索|来源)\b/i.test(userLower);

  const taskCompare =
    /\b(compare|versus|\bvs\.?\b|which is better|哪个好|还是|对比|利弊)\b/i.test(userLower) ||
    /\b(option a|option b|either\b)/i.test(assistantLower);

  const taskTest =
    /\b(test|tests|vitest|jest|pytest|coverage|单元测试|测试用例)\b/i.test(combined);

  const taskGit =
    /\b(git|commit|branch|merge|rebase|pull request|\bPR\b|提交|分支)\b/i.test(combined);

  const assistantTrim = ctx.assistantText.trim();
  const assistantAlreadyBullets = /^[-*•]|\n[-*•]|\n\d+\.\s/m.test(assistantTrim);
  const assistantAlreadyTable = /\|[^\n]+\|[^\n]+\|/.test(assistantTrim);
  const assistantAlreadyShort = assistantTrim.length < 120;
  const assistantOffersOptions =
    /\b(you can|either\b|options?:|可选|你可以|或者)\b/i.test(assistantLower);

  const userLangZh = ctx.locale === 'zh' || cjkRatio(combined) > 0.12;

  return {
    ...content,
    code: content.code && hasRealCode,
    taskEducational,
    hasRealCode,
    taskDebug,
    taskImplement,
    taskReview,
    taskPlan,
    taskConfig,
    taskResearch,
    taskCompare,
    taskTest,
    taskGit,
    assistantAlreadyBullets,
    assistantAlreadyTable,
    assistantAlreadyShort,
    assistantOffersOptions,
    userLangZh,
    toolsUsedWebSearch,
    toolsUsedWrite,
    toolsUsedShell,
    toolsUsedBrowser,
    anyToolError,
  };
}

function familyMaxForSignals(s: DerivedSignals): Record<FollowUpFamily, number> {
  const m = { ...BASE_FAMILY_MAX };
  if (s.code && s.web) m.code = Math.min(m.code, 2);
  if (s.code && s.email) m.code = Math.min(m.code, 2);
  if (s.code && s.date) m.code = Math.min(m.code, 2);
  if (s.web && s.email) {
    m.web = Math.min(m.web, 1);
    m.email = Math.min(m.email, 1);
  }
  if (s.taskConfig) m.ops = 1;
  if (s.taskGit || s.taskTest) m.workflow = 1;
  if (s.taskEducational) {
    m.code = 0;
    m.learn = 2;
  }
  return m;
}

function isIdAllowed(id: FollowUpSuggestionId, ctx: FollowUpContextPack, d: DerivedSignals): boolean {
  const { capabilities: cap } = ctx;
  if (id === 'web_more_details' || id === 'web_find_sources' || id === 'research_deeper') {
    if (!cap.capWebSearch) return false;
  }
  if (id === 'web_verify_claim' && !cap.capWebSearch) return false;
  if (id === 'wf_run_checks' && !cap.capShell) return false;
  if (id === 'wf_git_commit' && !cap.capShell) return false;
  if (id === 'code_add_tests' || id === 'code_fix_error') {
    if (!cap.capShell && !d.toolsUsedWrite) return false;
  }
  if (id === 'ops_schedule_cron' && !cap.capCron) return false;
  return true;
}

function multiply(m: Map<FollowUpSuggestionId, number>, id: FollowUpSuggestionId, factor: number) {
  if (!m.has(id)) return;
  m.set(id, (m.get(id) ?? 0) * factor);
}

function scoreIds(ctx: FollowUpContextPack, d: DerivedSignals): Map<FollowUpSuggestionId, number> {
  const combined = [ctx.userText, ctx.assistantText, ...ctx.recentUserTexts].filter(Boolean).join('\n');
  const m = new Map<FollowUpSuggestionId, number>();
  for (const id of ALL_IDS) {
    if (isIdAllowed(id, ctx, d)) m.set(id, 0);
  }

  const add = (id: FollowUpSuggestionId, v: number) => {
    if (!m.has(id)) return;
    m.set(id, (m.get(id) ?? 0) + v);
  };

  if (d.code) {
    add('code_error_handling', 52);
    add('code_explain', 51);
    add('code_refactor', 50);
    add('code_optimize', 49);
    add('code_add_tests', 48);
    add('code_fix_error', 47);
  }
  if (d.web) {
    add('web_more_details', 48);
    add('web_find_sources', 47);
    add('web_verify_claim', 46);
  }
  if (d.email) {
    add('email_make_formal', 46);
    add('email_shorten', 45);
    if (d.userLangZh) {
      add('email_make_formal', 3);
      add('email_shorten', 3);
    }
  }
  if (d.date) {
    add('date_shorter_summary', 44);
    add('date_main_risks', 43);
  }

  if (d.list) {
    add('generic_bullet_points', 28);
    add('generic_create_table', 26);
    add('generic_simpler_terms', 18);
    add('generic_action_checklist', 24);
  }
  if (d.table) {
    add('generic_bullet_points', 22);
    add('generic_simpler_terms', 20);
    add('generic_create_table', 16);
    add('generic_action_checklist', 18);
  }

  if (d.substantial) {
    add('generic_simpler_terms', 14);
    add('generic_concrete_example', 12);
    add('generic_bullet_points', 10);
    add('generic_assumptions', 10);
    add('generic_action_checklist', 12);
  } else {
    add('generic_simpler_terms', 8);
    add('generic_concrete_example', 6);
  }

  if (!d.code && !d.web && !d.email && !d.date && !d.list && !d.table) {
    add('generic_concrete_example', 6);
    add('research_deeper', 5);
  }

  if (d.taskDebug) {
    add('code_fix_error', 24);
    add('code_error_handling', 15);
    add('code_explain', 8);
  }
  if (d.taskImplement) {
    add('code_add_tests', 16);
    add('wf_run_checks', 14);
    add('code_refactor', 6);
  }
  if (d.taskReview) {
    add('code_refactor', 14);
    add('wf_verify_acceptance', 12);
    add('generic_assumptions', 8);
  }
  if (d.taskPlan) {
    add('generic_action_checklist', 20);
    add('what_next', 8);
    add('date_main_risks', 6);
  }
  if (d.taskConfig) {
    add('ops_fix_config', 22);
    add('ops_channel_next', 10);
  }
  if (d.taskResearch) {
    add('research_deeper', 18);
    add('web_find_sources', 10);
    add('web_verify_claim', 8);
  }
  if (d.taskEducational) {
    add('learn_technical_detail', 50);
    add('learn_build_walkthrough', 49);
    add('learn_compare_alternatives', 48);
    add('generic_concrete_example', 42);
    add('research_deeper', 38);
    add('web_more_details', 36);
    if (/技术实现|实现细节|原理|架构/i.test(ctx.assistantText) || /技术实现/i.test(ctx.userText)) {
      add('learn_technical_detail', 12);
    }
    if (/搭建|部署|动手|实践|demo/i.test(combined)) {
      add('learn_build_walkthrough', 14);
    }
    if (/对比|相比|区别|vs|或者/i.test(ctx.assistantText)) {
      add('learn_compare_alternatives', 10);
    }
  }
  if (d.taskCompare) add('wf_compare_options', 24);
  if (d.taskTest) {
    add('wf_run_checks', 20);
    add('code_add_tests', 12);
  }
  if (d.taskGit) {
    add('wf_git_commit', 22);
    add('code_refactor', 5);
  }

  if (d.toolsUsedWebSearch) add('web_verify_claim', 12);
  if (d.toolsUsedWrite) {
    add('code_add_tests', 14);
    add('wf_run_checks', 12);
    add('wf_git_commit', 10);
  }
  if (d.toolsUsedShell && d.taskDebug) add('code_fix_error', 10);
  if (d.toolsUsedShell && !d.taskDebug) add('wf_run_checks', 8);
  if (d.toolsUsedBrowser) add('web_verify_claim', 6);
  if (d.anyToolError) add('code_fix_error', 12);

  if (/xopc\.json|agents\.list|providers|gateway|workspace/i.test(ctx.userText)) {
    add('ops_fix_config', 16);
  }
  if (/telegram|weixin|channel|通道|gateway/i.test(ctx.userText)) {
    add('ops_channel_next', 22);
  }
  if (/cron|定时|schedule|每天|remind/i.test(ctx.userText)) {
    add('ops_schedule_cron', 20);
  }

  const recentHasEmail =
    ctx.recentUserTexts.some((t) => detectContentSignals(t, t.toLowerCase()).email) ||
    detectContentSignals(ctx.recentAssistantSnippet, ctx.recentAssistantSnippet.toLowerCase()).email;
  if (recentHasEmail && d.assistantAlreadyShort) {
    add('email_make_formal', 12);
    add('email_shorten', 12);
  }
  const recentHasCode = ctx.recentUserTexts.some(
    (t) => detectContentSignals(t, t.toLowerCase()).code,
  );
  if (recentHasCode && !d.code) add('code_explain', 10);

  if (ctx.priorTurnCount <= 1) {
    for (const id of ALL_IDS) {
      if (id.startsWith('generic_')) add(id, 4);
    }
  }
  if (ctx.priorTurnCount >= 3) {
    add('what_next', 4);
    add('generic_assumptions', 6);
  }

  if (ctx.userHasAttachments) add('generic_simpler_terms', 6);

  add('what_next', 40);

  if (d.assistantAlreadyBullets) multiply(m, 'generic_bullet_points', 0.2);
  if (d.assistantAlreadyTable) multiply(m, 'generic_create_table', 0.2);
  if (d.assistantAlreadyShort) multiply(m, 'generic_simpler_terms', 0.3);
  if (d.taskResearch && d.toolsUsedWebSearch) {
    for (const id of ALL_IDS) {
      if (id.startsWith('generic_')) multiply(m, id, 0.5);
    }
  }
  if (d.code && !d.web && !d.email) {
    for (const id of ALL_IDS) {
      if (id.startsWith('generic_')) multiply(m, id, 0.55);
    }
  }
  if (d.toolsUsedWebSearch) {
    multiply(m, 'web_more_details', 0.35);
    multiply(m, 'research_deeper', 0.35);
    multiply(m, 'web_verify_claim', 0.5);
  }
  if (d.taskDebug) {
    multiply(m, 'code_explain', 0.85);
    multiply(m, 'code_refactor', 0.85);
    multiply(m, 'code_optimize', 0.85);
    multiply(m, 'code_error_handling', 1.15);
    multiply(m, 'code_fix_error', 1.15);
  }
  if (d.assistantOffersOptions) multiply(m, 'wf_compare_options', 1.2);
  if (d.taskEducational && !d.hasRealCode) {
    for (const id of ALL_IDS) {
      if (id.startsWith('code_')) multiply(m, id, 0.06);
    }
    multiply(m, 'generic_action_checklist', 0.15);
    multiply(m, 'generic_simpler_terms', 0.25);
    multiply(m, 'code_explain', 0.06);
  }
  if (!d.substantial) {
    multiply(m, 'date_shorter_summary', 0.7);
    multiply(m, 'email_shorten', 0.7);
  }

  return m;
}

function selectFollowUps(
  scores: Map<FollowUpSuggestionId, number>,
  signals: DerivedSignals,
): FollowUpSuggestionId[] {
  const ranked = [...scores.keys()].sort((a, b) => {
    const diff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
    if (diff !== 0) return diff;
    return ALL_IDS.indexOf(a) - ALL_IDS.indexOf(b);
  });
  const familyMax = familyMaxForSignals(signals);

  const familyUsed: Record<FollowUpFamily, number> = {
    code: 0,
    web: 0,
    email: 0,
    date: 0,
    generic: 0,
    meta: 0,
    ops: 0,
    workflow: 0,
    learn: 0,
  };
  const picked: FollowUpSuggestionId[] = [];
  const pickedSet = new Set<FollowUpSuggestionId>();

  const tryPick = (id: FollowUpSuggestionId): boolean => {
    if (picked.length >= 4 || pickedSet.has(id)) return false;
    if (!scores.has(id)) return false;
    const fam = familyOf(id);
    if (familyUsed[fam] >= familyMax[fam]) return false;
    picked.push(id);
    pickedSet.add(id);
    familyUsed[fam] += 1;
    return true;
  };

  const nonWhatNext = ranked.filter((id) => id !== 'what_next');
  for (const id of nonWhatNext) {
    if (picked.length >= 3) break;
    tryPick(id);
  }

  if (!pickedSet.has('what_next')) tryPick('what_next');

  for (const id of nonWhatNext) {
    if (picked.length >= 4) break;
    tryPick(id);
  }

  const metaIdx = picked.indexOf('what_next');
  if (metaIdx >= 0 && metaIdx < picked.length - 1) {
    const [wn] = picked.splice(metaIdx, 1);
    picked.push(wn);
  }

  return picked.slice(0, 4);
}

/**
 * Score follow-up chips from a full context pack (phase-1 heuristic).
 */
export function suggestFollowUps(ctx: FollowUpContextPack): FollowUpSuggestionId[] {
  if (ctx.clarifyActive) return [];

  const combinedSlice = [ctx.userText, ctx.assistantText, ...ctx.recentUserTexts].filter(Boolean).join('\n');
  if (!combinedSlice.trim()) return [];

  const content = detectContentSignals(combinedSlice, combinedSlice.toLowerCase());
  const derived = detectDerived(ctx, content);
  const scores = scoreIds(ctx, derived);
  return selectFollowUps(scores, derived);
}

/**
 * Cheap follow-up prompts after an assistant turn (no extra LLM call).
 * Prefer {@link suggestFollowUps} with {@link buildFollowUpContextPack} when transcript is available.
 */
export function suggestFollowUpsFromAssistantMessage(msg: Message): FollowUpSuggestionId[] {
  if (msg.role !== 'assistant') return [];
  const ctx = buildFollowUpContextPack({
    messages: [msg],
    appendedAssistant: msg,
  });
  if (!ctx) return [];
  return suggestFollowUps(ctx);
}

export { buildFollowUpContextPack, collectPlainTextFromContent } from '@/features/chat/follow-up-context';
export type {
  BuildFollowUpContextInput,
  FollowUpCapabilities,
  FollowUpContextPack,
  ToolUseSummary,
} from '@/features/chat/follow-up-context';
export { DEFAULT_FOLLOW_UP_CAPABILITIES } from '@/features/chat/follow-up-context';
