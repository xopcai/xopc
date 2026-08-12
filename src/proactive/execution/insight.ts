import { stripCodeFences } from '../../agent/goals/judge.js';

import type { InsightCandidate } from './types.js';

const URGENCY = new Set(['low', 'medium', 'high', 'critical']);
const boundedText = (value: unknown, field: string, max: number): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Insight ${field} is required`);
  return value.trim().slice(0, max);
};

function parseDecision(value: unknown): InsightCandidate['decision'] {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Insight decision is invalid');
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.options) || row.options.length < 2 || row.options.length > 3) throw new Error('Insight decision options are invalid');
  const options = row.options.map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) throw new Error('Insight decision option is invalid');
    const item = option as Record<string, unknown>;
    return {
      id: boundedText(item.id, 'decision option id', 80),
      label: boundedText(item.label, 'decision option label', 120),
      consequence: boundedText(item.consequence, 'decision option consequence', 400),
    };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) throw new Error('Insight decision option ids must be unique');
  return { question: boundedText(row.question, 'decision question', 400), options };
}

export function parseInsightCandidate(raw: string, allowedEvidenceIds: Set<string>): InsightCandidate {
  let value: unknown;
  try { value = JSON.parse(stripCodeFences(raw)); } catch { throw new Error('Model output is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Insight must be a JSON object');
  const row = value as Record<string, unknown>;
  if (!URGENCY.has(String(row.urgency))) throw new Error('Insight urgency is invalid');
  if (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1) throw new Error('Insight confidence is invalid');
  if (!Array.isArray(row.evidenceIds) || row.evidenceIds.length === 0 || row.evidenceIds.length > 20) throw new Error('Insight evidenceIds are invalid');
  const evidenceIds = [...new Set(row.evidenceIds.map(String))];
  if (evidenceIds.some((id) => !allowedEvidenceIds.has(id))) throw new Error('Insight cites unknown evidence');
  const decision = parseDecision(row.decision);
  return {
    title: boundedText(row.title, 'title', 160), summary: boundedText(row.summary, 'summary', 1200),
    whyNow: boundedText(row.whyNow, 'whyNow', 800), impact: boundedText(row.impact, 'impact', 800),
    recommendation: boundedText(row.recommendation, 'recommendation', 800),
    workDone: boundedText(row.workDone, 'workDone', 800),
    ...(decision ? { decision } : {}),
    urgency: String(row.urgency) as InsightCandidate['urgency'], confidence: row.confidence, evidenceIds,
  };
}

export function scoreInsight(candidate: InsightCandidate): number {
  const urgencyWeight = { low: 0.15, medium: 0.45, high: 0.75, critical: 1 }[candidate.urgency];
  return Math.round((candidate.confidence * 0.7 + urgencyWeight * 0.3) * 1000) / 1000;
}

export function isValuableInsight(candidate: InsightCandidate): boolean {
  return candidate.confidence >= 0.65 && candidate.urgency !== 'low' && scoreInsight(candidate) >= 0.6;
}
