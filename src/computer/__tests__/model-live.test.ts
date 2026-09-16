import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ComputerModelAdapter, predictComputerStep } from '../model-adapter.js';

// Explicit opt-in. Synthetic pixels only; never a user's desktop or a real API-key fixture.
describe.skipIf(process.env.XOPC_COMPUTER_LIVE_TEST !== '1')('Alibaba hosted GUI model', () => {
  it.each([{ x: 80, y: 80 }, { x: 300, y: 250 }, { x: 560, y: 420 }])('grounds the synthetic button at $x,$y', async ({ x, y }) => {
    const image = await sharp(Buffer.from(`<svg width="800" height="600"><rect width="800" height="600" fill="white"/><rect x="${x}" y="${y}" width="200" height="80" rx="10" fill="#1769e0"/><text x="${x + 100}" y="${y + 52}" text-anchor="middle" font-size="28" fill="white">Continue</text></svg>`)).png().toBuffer();
    const adapter = new ComputerModelAdapter({ modelId: 'gui-plus-2026-02-26', profile: 'gui-plus-2026-02-26',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: process.env.DASHSCOPE_API_KEY ?? '' });
    let requests = 0;
    const proposal = await predictComputerStep(adapter, { goal: 'Click the blue Continue button once.', image, mimeType: 'image/png', width: 800, height: 600, summary: 'Synthetic test fixture; one Continue button.' }, () => { requests++; });
    expect(requests).toBeLessThanOrEqual(2);
    expect(proposal.kind).toBe('action');
    if (proposal.kind !== 'action' || proposal.action.kind !== 'click') throw new Error('Expected a grounded click');
    expect(proposal.action.point.x).toBeGreaterThanOrEqual(x);
    expect(proposal.action.point.x).toBeLessThan(x + 200);
    expect(proposal.action.point.y).toBeGreaterThanOrEqual(y);
    expect(proposal.action.point.y).toBeLessThan(y + 80);
    image.fill(0);
  }, 65_000);
});
