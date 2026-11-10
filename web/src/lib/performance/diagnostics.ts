/** Opt-in local diagnostics; enable with localStorage['xopc.performance'] = '1' and reload. */
export const performanceDiagnosticsEnabled = (() => {
  if (import.meta.env.DEV) return true;
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('xopc.performance') === '1'; }
  catch { return false; }
})();

export type JourneySample = { id: number; journey: string; phase: string; durationMs: number };
const samples: JourneySample[] = [];
let nextId = 0;

/** Returns a phase recorder without retaining conversation identifiers or content. */
export function beginJourney(journey: 'session_load' | 'new_session' | 'startup'): (phase: string) => void {
  if (!performanceDiagnosticsEnabled) return () => {};
  const id = ++nextId;
  const startedAt = performance.now();
  return phase => {
    samples.push({ id, journey, phase, durationMs: performance.now() - startedAt });
    if (samples.length > 200) samples.shift();
  };
}

const startupPhases = new Set<string>();
export function recordStartupPhase(phase: string): void {
  if (!performanceDiagnosticsEnabled || startupPhases.has(phase)) return;
  startupPhases.add(phase);
  samples.push({ id: 0, journey: 'startup', phase, durationMs: performance.now() });
  if (samples.length > 200) samples.shift();
}

export function getJourneyMetrics(): JourneySample[] { return samples.map(sample => ({ ...sample })); }
export function resetJourneyMetrics(): void { samples.length = 0; }

declare global {
  interface Window { __xopcJourneyMetrics?: typeof getJourneyMetrics; }
}
if (performanceDiagnosticsEnabled && typeof window !== 'undefined') window.__xopcJourneyMetrics = getJourneyMetrics;
