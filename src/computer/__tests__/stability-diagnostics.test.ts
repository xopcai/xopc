import { describe, expect, it } from 'vitest';
import { ComputerStabilityTracker } from '../stability-diagnostics.js';
import { ComputerOperationError } from '../errors.js';
import { ComputerSessionDiagnostics } from '../diagnostics.js';

const secret = 'private typed hello';
const before = { target: { appId: 'private.app', pid: 1, processIdentity: 'private-process', windowId: 'private-window',
  geometryRevision: 'private-geometry', width: 800, height: 600 }, imageWidth: 800, imageHeight: 600,
  stateDigest: 'private-digest', summary: JSON.stringify({ elements: [{ role: 'AXTextField', value: secret, enabled: true, bounds: { x: 1 } }] }) };

describe('private stability diagnostics', () => {
  it('identifies changed accessibility field categories and element positions without values', () => {
    const tracker = new ComputerStabilityTracker('pre_dispatch', 'click');
    tracker.compare(before, { ...before, stateDigest: 'new-private-digest', summary: JSON.stringify({ elements: [
      { role: 'AXTextField', value: 'new private text', enabled: false, bounds: { x: 2 } },
    ] }) });
    const diagnostic = tracker.diagnostic('COMPUTER_OBSERVATION_CHANGED', 4);
    expect(diagnostic.stability).toEqual({ stage: 'pre_dispatch', action: 'click', samples: 4,
      changes: ['accessibility_text', 'accessibility_state', 'accessibility_geometry'], changedElementIndices: [0] });
    const report = new ComputerSessionDiagnostics(); report.fail(new ComputerOperationError(diagnostic), 'dispatch');
    expect(report.snapshot().failure?.stability).toEqual(diagnostic.stability);
    expect(JSON.stringify(report.snapshot())).not.toMatch(/private|hello|digest|bounds/);
  });
  it('separates target, geometry, image dimensions and deadline changes', () => {
    const tracker = new ComputerStabilityTracker('pre_dispatch', 'activate');
    tracker.compare(before, { ...before, target: { ...before.target, windowId: 'different', geometryRevision: 'new' }, imageWidth: 900 });
    tracker.deadline();
    expect(tracker.diagnostic('COMPUTER_OBSERVATION_CHANGED', 1).stability?.changes)
      .toEqual(['window_identity', 'window_geometry', 'image_dimensions', 'deadline']);
  });
  it('labels digest-only changes conservatively rather than claiming a particular screen element changed', () => {
    const tracker = new ComputerStabilityTracker('post_action', 'click');
    tracker.compare(before, { ...before, stateDigest: 'changed' });
    expect(tracker.diagnostic('COMPUTER_UI_UNSTABLE', 4).stability?.changes).toEqual(['visual_or_unexposed_state']);
  });
  it('caps element indices and never copies malformed context', () => {
    const tracker = new ComputerStabilityTracker('initial_capture');
    tracker.compare(before, { ...before, summary: secret });
    tracker.compare(before, { ...before, summary: JSON.stringify({ elements: Array.from({ length: 40 }, () => ({ role: 'AXButton', label: secret })) }) });
    const diagnostic = tracker.diagnostic('COMPUTER_UI_UNSTABLE', 6);
    expect(diagnostic.stability?.changedElementIndices).toHaveLength(8);
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
  });
});
