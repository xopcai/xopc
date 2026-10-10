import type { EvalCase } from './fixtures.js';

export type EvalMode = 'direct' | 'batch' | 'codemode';
export type Sample = {
  key: string; caseId: string; category: string; mode: EvalMode; repeat: number;
  elapsedMs: number; requests: number; input: number; output: number; cacheRead: number; cacheWrite: number;
  costUsd: number; toolCalls: number; nestedCalls: number; usedCodemode: boolean;
  maxInputTokens: number;
  passed: boolean; sourcesComplete: boolean; forbiddenAccesses: number; stateLeaks: number;
  timeout: boolean; error?: string; response: string;
  infrastructureFailure?: string;
  observedSources: string[];
  toolTrace: { id: string; name: string; parentId?: string; args: unknown; isError?: boolean; durationMs?: number }[];
};

/** Provider outages invalidate a comparison; retain their rows without treating fast refusals as a benefit. */
export function classifyInfrastructureFailure(error: string | undefined): string | undefined {
  if (!error) return undefined;
  if (/\b400\b|invalid_request_error|invalid_parameter_error/i.test(error)) return 'protocol';
  if (/\b429\b|rate_limit_error|rate limit|速率限制/i.test(error)) return 'rate_limit';
  if (/\b402\b|insufficient balance|余额不足/i.test(error)) return 'balance';
  if (/\b40[13]\b|invalid.api.key|authentication_error/i.test(error)) return 'authentication';
  if (/\b5\d\d\b|overloaded_error|service unavailable/i.test(error)) return 'service';
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(error)) return 'transport';
  return undefined;
}

export function gradeAnswer(test: EvalCase, response: string, observed: ReadonlySet<string>) {
  try {
    const start = response.indexOf('{'), end = response.lastIndexOf('}');
    const answer = JSON.parse(response.slice(start, end + 1));
    const sources = answer.sources;
    const sourcesComplete = Array.isArray(sources) && sources.every(s => typeof s === 'string')
      && JSON.stringify([...new Set(sources)].sort()) === JSON.stringify([...test.sources].sort())
      && test.sources.every(source => observed.has(source));
    return { passed: answer.answer === test.answer && answer.status === test.status && sourcesComplete, sourcesComplete };
  } catch { return { passed: false, sourcesComplete: false }; }
}

export function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : 0;
}

export function summarize(samples: Sample[]) {
  const byMode = Object.fromEntries((['direct', 'batch', 'codemode'] as const).map(mode => {
    const rows = samples.filter(row => row.mode === mode);
    const sum = (field: keyof Sample) => rows.reduce((value, row) => value + Number(row[field]), 0);
    return [mode, { samples: rows.length, passed: sum('passed'), successRate: rows.length ? sum('passed') / rows.length : 0,
      sourcesComplete: sum('sourcesComplete'), medianMs: percentile(rows.map(row => row.elapsedMs), 0.5), p95Ms: percentile(rows.map(row => row.elapsedMs), 0.95),
      requests: sum('requests'), input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), costUsd: sum('costUsd'),
      maxInputTokens: Math.max(0, ...rows.map(row => row.maxInputTokens ?? 0)),
      toolCalls: sum('toolCalls'), nestedCalls: sum('nestedCalls'), usedCodemode: sum('usedCodemode'),
      timeouts: sum('timeout'), forbiddenAccesses: sum('forbiddenAccesses'), stateLeaks: sum('stateLeaks') }];
  }));
  const categories = [...new Set(samples.map(row => row.category))];
  return { byMode, byCategory: Object.fromEntries(categories.map(category => [category,
    Object.fromEntries((['direct', 'batch', 'codemode'] as const).map(mode => {
      const rows = samples.filter(row => row.mode === mode && row.category === category);
      return [mode, { samples: rows.length, passed: rows.filter(row => row.passed).length,
        medianMs: percentile(rows.map(row => row.elapsedMs), 0.5), p95Ms: percentile(rows.map(row => row.elapsedMs), 0.95),
        input: rows.reduce((a, row) => a + row.input + row.cacheRead + row.cacheWrite, 0), costUsd: rows.reduce((a, row) => a + row.costUsd, 0) }];
    }))])) };
}

/** Resample whole tasks, retaining all repetitions and strategies as one cluster. */
export function compareStrategies(samples: Sample[]) {
  const summary = summarize(samples);
  const candidates = samples.filter(row => !['git', 'failure'].includes(row.category) && row.caseId !== 'files-0');
  const ids = [...new Set(candidates.map(row => row.caseId))];
  const input = (rows: Sample[]) => rows.reduce((sum, row) => sum + row.input + row.cacheRead + row.cacheWrite, 0);
  const ratio = (a: number, b: number) => b > 0 ? a / b : null;
  let seed = 20261010;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const codemode = candidates.filter(row => row.mode === 'codemode');
  const comparisons = Object.fromEntries((['direct', 'batch'] as const).map(mode => {
    const baseline = candidates.filter(row => row.mode === mode);
    const draws: number[] = [];
    for (let draw = 0; draw < 2000 && ids.length; draw++) {
      const selected = Array.from({ length: ids.length }, () => ids[Math.floor(random() * ids.length)]);
      const rows = selected.flatMap(id => candidates.filter(row => row.caseId === id));
      const a = rows.filter(row => row.mode === 'codemode'), b = rows.filter(row => row.mode === mode);
      const value = ratio(percentile(a.map(row => row.elapsedMs), 0.5), percentile(b.map(row => row.elapsedMs), 0.5));
      if (value !== null) draws.push(value);
    }
    return [mode, { combinationTasks: ids.length,
      combinationMedianRatio: ratio(percentile(codemode.map(row => row.elapsedMs), 0.5), percentile(baseline.map(row => row.elapsedMs), 0.5)),
      medianRatio95CI: [percentile(draws, 0.025), percentile(draws, 0.975)],
      combinationInputRatio: ratio(input(codemode), input(baseline)),
      overallP95Ratio: ratio(summary.byMode.codemode.p95Ms, summary.byMode[mode].p95Ms),
      overallSuccessDifference: summary.byMode.codemode.successRate - summary.byMode[mode].successRate,
    }];
  }));
  const gates = Object.values(comparisons).map(comparison => ({
    quality: comparison.overallSuccessDifference >= 0,
    tail: comparison.overallP95Ratio !== null && comparison.overallP95Ratio <= 1.1,
    benefit: comparison.combinationMedianRatio !== null && comparison.combinationMedianRatio <= 0.8
      || comparison.combinationInputRatio !== null && comparison.combinationInputRatio <= 0.85,
  }));
  const noViolations = samples.every(row => row.forbiddenAccesses === 0 && row.stateLeaks === 0);
  const allIds = [...new Set(samples.map(row => row.caseId))];
  const sampleGate = allIds.length >= 30 && allIds.every(id => (['direct', 'batch', 'codemode'] as const)
    .every(mode => samples.filter(row => row.caseId === id && row.mode === mode).length >= 3));
  const infrastructureFailures = samples.filter(row => row.infrastructureFailure || classifyInfrastructureFailure(row.error)).length;
  const validComparison = infrastructureFailures === 0;
  return { comparisons, noViolations, sampleGate, infrastructureFailures, validComparison,
    modelEvaluationGatePassed: validComparison && sampleGate && noViolations && gates.every(gate => gate.quality && gate.tail && gate.benefit),
    policy: 'Keep opt-in until model evaluation gates, deterministic checks and a scoped daily-use pilot all pass.' };
}
