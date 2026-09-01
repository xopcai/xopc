import { describe, expect, it } from 'vitest';

import { QuitConfirmationGate } from '../quit-confirmation.js';

describe('QuitConfirmationGate', () => {
  it('opens one confirmation while repeated quit requests remain blocked', () => {
    const gate = new QuitConfirmationGate();

    expect(gate.begin(true)).toBe('confirm');
    expect(gate.begin(true)).toBe('block');
  });

  it('allows retry after cancellation and the cleanup quit after acceptance', () => {
    const gate = new QuitConfirmationGate();

    expect(gate.begin(true)).toBe('confirm');
    expect(gate.resolve(false)).toBe(false);
    expect(gate.begin(true)).toBe('confirm');
    expect(gate.resolve(true)).toBe(true);
    expect(gate.begin(true)).toBe('allow');
  });

  it('allows explicitly bypassed and not-ready quits without a dialog', () => {
    const bypassed = new QuitConfirmationGate();
    bypassed.bypass();
    expect(bypassed.begin(true)).toBe('allow');

    const headless = new QuitConfirmationGate();
    expect(headless.begin(false)).toBe('allow');
  });
});
