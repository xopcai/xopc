import type { CampaignPlan } from './campaign.js';

/** Prepare a bounded plan only; credentials are resolved by the existing isolated launcher at run time. */
export function livePilotPlan(model: string, origins: string[], includePersonal = false): CampaignPlan {
  if (!/^[a-z][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) throw new Error('Expected a registered provider/model');
  if (!origins.length || origins.some(origin => new URL(origin).origin !== origin)) throw new Error('Declare exact model HTTP origins');
  const selections = [
    { id: 'convergence-core', suite: 'xopc-core', cases: ['C01-add-deliverable', 'C02-replace-scope'] },
    { id: 'convergence-growth', suite: 'xopc-agent-growth', cases: ['E01-verified-stop', 'E02-green-incomplete', 'P01-inventory-cache'] },
    { id: 'delivery-core', suite: 'xopc-core', cases: ['F01-lost-artifact', 'F02-transient-read'] },
  ];
  const plan: CampaignPlan = { id: 'stage-one-live-pilot', concurrency: 2, maxWallMs: 1200000, maxRequests: 160, modelOrigins: origins,
    pool: { generation: 4, judge: 2, parent: 4 }, jobs: selections.map(s => ({
      id: s.id, timeoutMs: 900000, args: ['--import', 'tsx', 'evals/coder/scripts/run-benchmark-live.mjs', '--suite', s.suite, '--model', model,
        '--cases', s.cases.join(','), '--repetitions', '1', '--output', `{output}/${s.id}`],
      evidence: [{ path: `{output}/${s.id}/benchmark/evals.db`, manifest: `{output}/${s.id}/benchmark/manifest.json`,
        kind: 'coder-db', benchmark: s.suite, evidenceClass: 'live_controlled', expected: s.cases.length }],
    })) };
  if (includePersonal) plan.jobs.push({ id: 'personal-live-mixed', timeoutMs: 900000,
    args: ['--import', 'tsx', 'scripts/personal-repair-live-benchmark.mts', '--rounds', '1', '--scenarios', 'mixed', '--output-dir', '{output}/personal-live'],
    evidence: [{ path: '{output}/personal-live/summary.json', kind: 'delivery', benchmark: 'personal-delivery', evidenceClass: 'live_product', expected: 1 }],
  });
  return plan;
}
