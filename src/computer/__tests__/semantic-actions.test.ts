import { describe, expect, it } from 'vitest';
import type { ComputerAction, ComputerObservation } from '@xopcai/computer-control-contract';
import { groundComputerAction } from '../semantic-actions.js';

const click = { kind: 'click', point: { x: 40, y: 30 }, button: 'left', count: 1 } as const;
const element = { ref: 'e1', role: 'AXButton', semanticActions: ['activate', 'showMenu'],
  bounds: { x: 20, y: 10, width: 40, height: 40 } };
const observation = (elements: unknown[]): ComputerObservation => ({ imageWidth: 800, imageHeight: 600,
  summary: JSON.stringify({ elements }) }) as ComputerObservation;

describe('native semantic grounding', () => {
  it('grounds only a unique advertised control under the actual screenshot point', () => {
    expect(groundComputerAction(click, observation([element]))).toEqual({ kind: 'activate', ref: 'e1' });
    expect(groundComputerAction({ ...click, button: 'right' }, observation([element]))).toEqual({ kind: 'showMenu', ref: 'e1' });
    expect(groundComputerAction(click, observation([{ ref: 'e0', role: 'AXWindow', actions: ['AXRaise', 'AXCancel'],
      bounds: { x: 0, y: 0, width: 800, height: 600 } }, element]))).toEqual({ kind: 'activate', ref: 'e1' });
  });
  it.each([
    [], [element, { ...element, ref: 'e2' }], [{ ...element, enabled: false }],
    [element, { ...element, ref: 'e2', enabled: false }],
    [element, { ...element, ref: 'e2', semanticActions: [] }],
    [{ ...element, in_web_content: true }], [{ ...element, semanticActions: [] }],
    [{ ...element, bounds: { ...element.bounds, width: 0 } }], [null],
  ].map(elements => [elements]))('retains the original click when grounding is unavailable or ambiguous: %j', elements => {
    expect(groundComputerAction(click, observation(elements))).toBe(click);
  });
  it('preserves double clicks, other actions, outside points and malformed summaries', () => {
    const actions: ComputerAction[] = [{ ...click, count: 2 }, { ...click, point: { x: 800, y: 30 } },
      { kind: 'activate', ref: 'e1' }, { kind: 'setValue', ref: 'e1', text: 'x' }];
    for (const action of actions) expect(groundComputerAction(action, observation([element]))).toBe(action);
    expect(groundComputerAction(click, { ...observation([]), summary: 'invalid' })).toBe(click);
    expect(groundComputerAction(click, { ...observation([]), summary: JSON.stringify({ elements: [element], truncated: true }) })).toBe(click);
  });
});
