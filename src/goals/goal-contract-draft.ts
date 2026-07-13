import type { UserMessage } from '@earendil-works/pi-ai';
import { complete } from '@earendil-works/pi-ai/compat';

import { getApiKey, resolveModel } from '../providers/index.js';
import type { GoalContractInput } from './types.js';

const MAX_ITEMS = 7;

export type GoalContractDraftInput = {
  title: string;
  context?: string;
  criteria?: string[];
  uiLocale?: 'en' | 'zh';
  modelRef?: string;
  signal?: AbortSignal;
};

export type GoalContractDraftResult = {
  contract: GoalContractInput;
  generated: boolean;
  warning?: string;
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text?: unknown } => Boolean(block && typeof block === 'object'))
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
    .trim();
}

function parseJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function fallbackContract(input: GoalContractDraftInput): GoalContractInput {
  const title = input.title.trim();
  const criteria = stringList(input.criteria);
  const isChinese = input.uiLocale === 'zh';
  return {
    objective: title,
    scopeBoundary: input.context?.trim() || undefined,
    criteria: criteria.length
      ? criteria
      : isChinese
        ? [
            `“${title}”具有清晰且可由用户验证的最终结果。`,
            `“${title}”在约定范围内完成所需工作。`,
          ]
        : [
            `${title} has a clear, user-verifiable outcome.`,
            `The required work for ${title} is complete within the stated scope.`,
          ],
    evidencePlan: [isChinese
      ? '提供可检查的测试结果、产物、链接或报告，以证明目标完成。'
      : 'Record an inspectable test result, artifact, link, or report that proves completion.'],
  };
}

function normalizedModelContract(data: Record<string, unknown>, fallback: GoalContractInput): GoalContractInput {
  const objective = typeof data.objective === 'string' && data.objective.trim()
    ? data.objective.trim()
    : fallback.objective;
  const scopeBoundary = typeof data.scopeBoundary === 'string' && data.scopeBoundary.trim()
    ? data.scopeBoundary.trim()
    : fallback.scopeBoundary;
  const criteria = stringList(data.criteria);
  const evidencePlan = stringList(data.evidencePlan);
  return {
    objective,
    scopeBoundary,
    criteria: criteria.length ? criteria : fallback.criteria,
    evidencePlan: evidencePlan.length ? evidencePlan : fallback.evidencePlan,
  };
}

export async function draftGoalContract(input: GoalContractDraftInput): Promise<GoalContractDraftResult> {
  const fallback = fallbackContract(input);
  if (!input.modelRef?.trim()) {
    return {
      contract: fallback,
      generated: false,
      warning: input.uiLocale === 'zh' ? '未配置用于定义目标的模型，已生成可编辑的本地草案。' : 'No model is configured for goal drafting.',
    };
  }

  try {
    const model = resolveModel(input.modelRef.trim());
    const apiKey = await getApiKey(model.provider);
    const prompt = [
      'Turn the explicitly requested persistent goal into a concise, measurable goal contract.',
      'Preserve the user intent. Do not claim work is done. Do not include markdown or commentary.',
      'Return only one JSON object with objective, scopeBoundary, criteria, and evidencePlan.',
      'criteria and evidencePlan must each contain 1 to 7 concrete, observable strings.',
      'The scope boundary must state material exclusions when possible.',
      input.uiLocale === 'zh' ? 'Return every string value in Simplified Chinese.' : 'Return every string value in English.',
      '',
      `Goal title: ${input.title.trim()}`,
      `Context: ${input.context?.trim() || '(none)'}`,
      `Existing acceptance criteria: ${stringList(input.criteria).join(' | ') || '(none)'}`,
    ].join('\n');
    const message: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
    const result = await complete(model, { messages: [message] }, {
      apiKey,
      maxTokens: 1200,
      temperature: 0,
      signal: input.signal,
    });
    const parsed = parseJson(extractText(result.content));
    if (!parsed) return {
      contract: fallback,
      generated: false,
      warning: input.uiLocale === 'zh' ? '模型未返回有效的目标契约，已生成可编辑的本地草案。' : 'The model did not return a valid goal contract.',
    };
    return { contract: normalizedModelContract(parsed, fallback), generated: true };
  } catch {
    return {
      contract: fallback,
      generated: false,
      warning: input.uiLocale === 'zh' ? '目标定义暂不可用，已生成可编辑的本地草案。' : 'Goal drafting is unavailable; a local draft was prepared instead.',
    };
  }
}
