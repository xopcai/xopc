import type { UserMessage } from '@earendil-works/pi-ai';
import { complete } from '@earendil-works/pi-ai/compat';

import { getApiKey, resolveModel } from '../providers/index.js';
import type { GoalEvidence, GoalEvidenceRequirement } from './types.js';

export type GoalEvidenceReviewVerdict = 'approved' | 'needs_more_evidence' | 'rejected';

export type GoalEvidenceReviewResult = {
  verdict: GoalEvidenceReviewVerdict;
  reason: string;
  confidence?: number;
  generated: boolean;
  warning?: string;
};

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

function localReview(requirement: GoalEvidenceRequirement, evidence: GoalEvidence[]): GoalEvidenceReviewResult {
  if (!evidence.length) {
    return {
      verdict: 'needs_more_evidence',
      reason: `No evidence is linked to the requirement: ${requirement.text}`,
      generated: false,
    };
  }
  return {
    verdict: 'needs_more_evidence',
    reason: `${evidence.length} evidence item(s) are linked. Configure a goal judge model to assess whether they prove this requirement, then approve the result manually.`,
    generated: false,
    warning: 'No model is configured for evidence review.',
  };
}

export async function reviewGoalEvidenceRequirement(input: {
  requirement: GoalEvidenceRequirement;
  evidence: GoalEvidence[];
  modelRef?: string;
  signal?: AbortSignal;
}): Promise<GoalEvidenceReviewResult> {
  const fallback = localReview(input.requirement, input.evidence);
  if (!input.modelRef?.trim() || input.evidence.length === 0) return fallback;
  try {
    const model = resolveModel(input.modelRef.trim());
    const apiKey = await getApiKey(model.provider);
    const prompt = [
      'Assess whether the linked evidence proves the single goal requirement.',
      'Be conservative: never infer facts that are absent from the supplied evidence.',
      'Return only JSON with verdict (approved, needs_more_evidence, or rejected), reason, and confidence (0 to 1).',
      'An approved result is advisory and still needs a human approval before goal completion.',
      '',
      `Requirement: ${input.requirement.text}`,
      'Linked evidence:',
      ...input.evidence.map((item, index) => [
        `${index + 1}. kind=${item.kind}; title=${item.title}`,
        item.summary ? `summary=${item.summary}` : '',
        item.uri ? `uri=${item.uri}` : '',
      ].filter(Boolean).join('; ')),
    ].join('\n');
    const message: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
    const response = await complete(model, { messages: [message] }, {
      apiKey,
      maxTokens: 700,
      temperature: 0,
      signal: input.signal,
    });
    const parsed = parseJson(extractText(response.content));
    if (!parsed) return { ...fallback, warning: 'The model did not return a valid evidence review.' };
    const verdict = parsed.verdict;
    if (verdict !== 'approved' && verdict !== 'needs_more_evidence' && verdict !== 'rejected') {
      return { ...fallback, warning: 'The model returned an unsupported evidence verdict.' };
    }
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'The model did not provide a review rationale.';
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : undefined;
    return { verdict, reason, confidence, generated: true };
  } catch {
    return { ...fallback, warning: 'Evidence review is unavailable; manual approval remains available.' };
  }
}
