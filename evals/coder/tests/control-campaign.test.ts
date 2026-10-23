import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlStore } from '../../control/store.js';
import { runCampaign, type CampaignPlan } from '../../control/campaign.js';
import { record } from '../../control/types.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xopc-control-campaign-')); roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'results'));
  return { root, output: join(root, 'results', 'run'), store: new ControlStore(join(root, 'index.db')) };
}

describe('campaign process integration', () => {
  it('executes independent children, blocks failed dependencies, and persists all outcomes', async () => {
    const { root, output, store } = fixture();
    const plan: CampaignPlan = { id: 'test', concurrency: 2, maxWallMs: 5000, jobs: [
      { id: 'good', args: ['-e', 'process.exit(0)'], timeoutMs: 1000 },
      { id: 'bad', args: ['-e', 'process.exit(1)'], timeoutMs: 1000 },
      { id: 'blocked', args: ['-e', 'process.exit(0)'], timeoutMs: 1000, dependsOn: ['bad'] },
    ] };
    try {
      const state = await runCampaign(plan, root, output, store);
      const jobs = record(state.jobs);
      expect(state.status).toBe('failed'); expect(record(jobs.good).status).toBe('passed');
      expect(record(jobs.bad).status).toBe('failed'); expect(record(jobs.blocked).status).toBe('blocked');
      expect(JSON.parse(readFileSync(join(output, 'campaign.json'), 'utf8')).pool.active).toBe(0);
      expect(store.campaigns()).toHaveLength(1);
      const before = readFileSync(join(output, 'bad-1.json'));
      const resumed = await runCampaign(plan, root, output, store, true);
      expect(resumed.status).toBe('interrupted');
      expect(readFileSync(join(output, 'bad-1.json')).equals(before)).toBe(true);
    } finally { store.close(); }
  });

  it('marks missing mandatory evidence as protocol failure despite child exit zero', async () => {
    const { root, output, store } = fixture();
    const plan: CampaignPlan = { id: 'evidence', concurrency: 1, maxWallMs: 5000, jobs: [
      { id: 'missing', args: ['-e', 'process.exit(0)'], timeoutMs: 1000, evidence: [
        { path: '{output}/missing.json', kind: 'delivery', benchmark: 'personal-delivery', evidenceClass: 'deterministic' },
      ] },
    ] };
    try {
      const state = await runCampaign(plan, root, output, store);
      expect(state.status).toBe('failed'); expect(state.validity).toBe('invalid');
      expect(record(record(state.jobs).missing).exitCode).toBe(0);
    } finally { store.close(); }
  });

  it('pauses admission through durable commands then drains cancellation', async () => {
    const { root, output, store } = fixture();
    const plan: CampaignPlan = { id: 'pause', concurrency: 1, maxWallMs: 5000, jobs: [
      { id: 'first', args: ['-e', 'setTimeout(()=>{},1000)'], timeoutMs: 3000 },
      { id: 'second', args: ['-e', 'process.exit(0)'], timeoutMs: 1000 },
    ] };
    try {
      const running = runCampaign(plan, root, output, store);
      await new Promise(r => setTimeout(r, 60));
      const id = String(store.campaigns()[0]!.id);
      store.event('campaign.control', { id, action: 'pause' });
      await new Promise(r => setTimeout(r, 1100));
      expect(record(store.campaigns()[0]!.jobs).second).toBeUndefined();
      store.event('campaign.control', { id, action: 'cancel' });
      const result = await running;
      expect(result.status).toBe('interrupted');
      expect(record(result.pool)).toMatchObject({ active: 0, queued: 0 });
    } finally { store.close(); }
  });
});
