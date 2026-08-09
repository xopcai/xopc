import type { AutomationRun } from '../automations/index.js';
import { createLogger } from '../utils/logger.js';

import { createFocusInsight } from './insight-repository.js';
import {
  createFocusActivity,
  getFocusMonitorByAutomationId,
  updateFocusMonitorRuntime,
} from './repository.js';
import type { FocusEvidence, FocusInsight } from './types.js';

const log = createLogger('FocusRunProcessor');

interface MeaningfulResult {
  meaningful: true;
  title: string;
  summary: string;
  whyItMatters: string;
  nextAction: string;
  evidence: FocusEvidence[];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseFocusMonitorResult(summary: string): MeaningfulResult | { meaningful: false } | null {
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
    ? result.evidence.flatMap((item): FocusEvidence[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const label = nonEmptyString(record.label);
        const source = nonEmptyString(record.source);
        const publishedAtValue = nonEmptyString(record.publishedAt);
        const publishedAt = publishedAtValue && Number.isFinite(Date.parse(publishedAtValue))
          ? new Date(publishedAtValue).toISOString()
          : null;
        return label ? [{
          label,
          ...(source ? { source } : {}),
          ...(publishedAt ? { publishedAt } : {}),
        }] : [];
      }).slice(0, 8)
    : [];
  if (!title || !resultSummary || !whyItMatters || !nextAction || evidence.length === 0) return null;
  return { meaningful: true, title, summary: resultSummary, whyItMatters, nextAction, evidence };
}

function hasDatedExternalEvidence(evidence: FocusEvidence[]): boolean {
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

export function processFocusMonitorRun(run: AutomationRun): {
  handled: boolean;
  insight?: FocusInsight;
} {
  const monitor = getFocusMonitorByAutomationId(run.automationId);
  if (!monitor) return { handled: false };
  if (monitor.lastRunId === run.id && monitor.lastRunAt != null) return { handled: true };
  const endedAt = run.endedAtMs ?? Date.now();

  if (run.status !== 'succeeded' || !run.summary) {
    const errorMessage = run.error || `Monitor run ${run.status}`;
    updateFocusMonitorRuntime({
      id: monitor.id,
      runState: 'failed',
      lastRunId: run.id,
      lastRunAt: endedAt,
      error: errorMessage,
    });
    createFocusActivity({
      focusId: monitor.focusId,
      monitorId: monitor.id,
      type: 'run_failed',
      summary: errorMessage,
      details: { runId: run.id },
      nowMs: endedAt,
    });
    return { handled: true };
  }

  const result = parseFocusMonitorResult(run.summary);
  if (!result || (result.meaningful && monitor.kind === 'external_changes' && !hasDatedExternalEvidence(result.evidence))) {
    updateFocusMonitorRuntime({
      id: monitor.id,
      runState: 'failed',
      lastRunId: run.id,
      lastRunAt: endedAt,
      error: 'Monitor returned an invalid result',
    });
    createFocusActivity({
      focusId: monitor.focusId,
      monitorId: monitor.id,
      type: 'run_failed',
      summary: 'Monitor returned an invalid result',
      details: { runId: run.id },
      nowMs: endedAt,
    });
    log.warn({ automationId: run.automationId, runId: run.id, monitorKind: monitor.kind }, 'Focus monitor returned an invalid result');
    return { handled: true };
  }

  updateFocusMonitorRuntime({
    id: monitor.id,
    runState: 'idle',
    lastRunId: run.id,
    lastRunAt: endedAt,
    meaningful: result.meaningful,
    error: null,
  });
  if (!result.meaningful) {
    createFocusActivity({
      focusId: monitor.focusId,
      monitorId: monitor.id,
      type: 'run_no_change',
      summary: 'No meaningful change found',
      details: { runId: run.id },
      nowMs: endedAt,
    });
    return { handled: true };
  }

  const insight = createFocusInsight({
    focusId: monitor.focusId,
    monitorId: monitor.id,
    runId: run.id,
    kind: monitor.kind,
    title: result.title,
    summary: result.summary,
    whyItMatters: result.whyItMatters,
    nextAction: result.nextAction,
    evidence: result.evidence,
    nowMs: endedAt,
  });
  if (insight) {
    createFocusActivity({
      focusId: monitor.focusId,
      monitorId: monitor.id,
      type: 'insight_created',
      summary: insight.title,
      details: { runId: run.id, insightId: insight.id },
      nowMs: endedAt,
    });
    return { handled: true, insight };
  }
  return { handled: true };
}
