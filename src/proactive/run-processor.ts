import type { AutomationRun } from '../automations/index.js';
import { createLogger } from '../utils/logger.js';

import { createProactiveInsight } from './insight-repository.js';
import type { ProactiveEvidence, ProactiveInsight } from './types.js';
import { getFocusWatchByAutomationId, recordFocusWatchRun } from './watch-repository.js';

const log = createLogger('ProactiveRunProcessor');

interface MeaningfulResult {
  meaningful: true;
  title: string;
  summary: string;
  whyItMatters: string;
  nextAction: string;
  evidence: ProactiveEvidence[];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseFocusRunResult(summary: string): MeaningfulResult | { meaningful: false } | null {
  const start = summary.indexOf('{');
  const end = summary.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(summary.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.meaningful === false) return { meaningful: false };
  if (result.meaningful !== true) return null;
  const title = nonEmptyString(result.title);
  const resultSummary = nonEmptyString(result.summary);
  const whyItMatters = nonEmptyString(result.whyItMatters);
  const nextAction = nonEmptyString(result.nextAction);
  const evidence = Array.isArray(result.evidence)
    ? result.evidence.flatMap((item): ProactiveEvidence[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const label = nonEmptyString((item as Record<string, unknown>).label);
        const source = nonEmptyString((item as Record<string, unknown>).source);
        const publishedAtValue = nonEmptyString((item as Record<string, unknown>).publishedAt);
        const publishedAt = publishedAtValue && Number.isFinite(Date.parse(publishedAtValue))
          ? new Date(publishedAtValue).toISOString()
          : null;
        return label ? [{ label, ...(source ? { source } : {}), ...(publishedAt ? { publishedAt } : {}) }] : [];
      }).slice(0, 8)
    : [];
  if (!title || !resultSummary || !whyItMatters || !nextAction || evidence.length === 0) return null;
  return { meaningful: true, title, summary: resultSummary, whyItMatters, nextAction, evidence };
}

export function hasValidIntelligenceEvidence(evidence: ProactiveEvidence[]): boolean {
  return evidence.some((item) => {
    if (!item.source || !item.publishedAt) return false;
    try {
      const url = new URL(item.source);
      return (url.protocol === 'https:' || url.protocol === 'http:') && Number.isFinite(Date.parse(item.publishedAt));
    } catch {
      return false;
    }
  });
}

export function processFocusAutomationRun(run: AutomationRun): {
  handled: boolean;
  insight?: ProactiveInsight;
} {
  const watch = getFocusWatchByAutomationId(run.automationId);
  if (!watch) return { handled: false };
  if (run.status !== 'succeeded' || !run.summary) {
    recordFocusWatchRun({ id: watch.id, runId: run.id, outcome: 'failed', nowMs: run.endedAtMs });
    return { handled: true };
  }
  const result = parseFocusRunResult(run.summary);
  if (!result) {
    recordFocusWatchRun({ id: watch.id, runId: run.id, outcome: 'failed', nowMs: run.endedAtMs });
    log.warn({ automationId: run.automationId, runId: run.id }, 'Focus watch returned an invalid result');
    return { handled: true };
  }
  if (result.meaningful && watch.kind === 'intelligence' && !hasValidIntelligenceEvidence(result.evidence)) {
    recordFocusWatchRun({ id: watch.id, runId: run.id, outcome: 'failed', nowMs: run.endedAtMs });
    log.warn({ automationId: run.automationId, runId: run.id }, 'Intelligence watch result lacked dated web evidence');
    return { handled: true };
  }
  const recorded = recordFocusWatchRun({
    id: watch.id,
    runId: run.id,
    outcome: result.meaningful ? 'meaningful' : 'empty',
    nowMs: run.endedAtMs,
  });
  if (!recorded) return { handled: true };
  if (!result.meaningful) return { handled: true };
  const insight = createProactiveInsight({
      watchId: watch.id,
      runId: run.id,
      kind: watch.kind,
      title: result.title,
      summary: result.summary,
      whyItMatters: result.whyItMatters,
      nextAction: result.nextAction,
      evidence: result.evidence,
      nowMs: run.endedAtMs,
    });
  return insight ? { handled: true, insight } : { handled: true };
}
