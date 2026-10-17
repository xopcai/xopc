import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { ComputerFlowCapture, ComputerFlowSchema, ComputerFlowStore, computerFlowHint } from '../flows.js';
import { verifyComputerExpectation } from '../task-state.js';

const observation = (selected = false) => ({ target: { appId: 'native.app', processIdentity: 'instance', windowId: 'window' },
  summary: JSON.stringify({ elements: [{ role: 'AXWindow' }, { role: 'AXRadioButton', ref: 'private-ref', label: 'Memories',
    selected, semanticActions: ['activate'] }] }) }) as any;
const receipt = { actionId: 'action', dispatch: 'completed', outcome: 'unknown', verification: 'visual' } as const;
const expectation = { kind: 'selected', label: 'Memories' } as const;
function capture() {
  const result = new ComputerFlowCapture(), before = observation(), after = observation(true);
  result.record({ kind: 'activate', ref: 'private-ref' }, before, receipt, after, expectation,
    verifyComputerExpectation(expectation, after, before));
  return result;
}
const draft = () => capture().finish('Open memories', 'desktop');
const roots: string[] = [];
afterEach(() => { closeXopcDatabase(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.restoreAllMocks(); });
function database() {
  const root = mkdtempSync(join(tmpdir(), 'computer-flows-')); roots.push(root);
  const path = join(root, 'xopc.db'); openXopcDatabase({ path }); return path;
}

describe('verified computer flow capture', () => {
  it('retains semantic hints and selected evidence without executable arguments or private context', () => {
    expect(draft()).toEqual({ title: 'Open memories', endpointId: 'desktop', appId: 'native.app',
      steps: [{ kind: 'activate', role: 'AXRadioButton', label: 'Memories' }], condition: expectation, coverage: 'complete' });
    expect(JSON.stringify(draft())).not.toMatch(/private-ref|window|processIdentity|actionId|coordinates|stateDigest|summary/);
    expect(computerFlowHint({ ...draft() } as any)).toMatch(/not instructions, authorization, or proof/);
  });
  it('keeps an ordered multi-step routine while requiring evidence on its final step', () => {
    const result = new ComputerFlowCapture(), before = observation(), middle = observation();
    const tree = JSON.parse(before.summary); tree.elements[1].label = 'Settings'; before.summary = JSON.stringify(tree);
    result.record({ kind: 'activate', ref: 'private-ref' }, before, receipt, middle);
    expect(() => result.finish('Routine', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
    const after = observation(true);
    result.record({ kind: 'activate', ref: 'private-ref' }, middle, { ...receipt, actionId: 'second-action' }, after,
      expectation, verifyComputerExpectation(expectation, after, middle));
    expect(result.finish('Routine', 'desktop').steps.map(step => step.label)).toEqual(['Settings', 'Memories']);
  });
  it.each([
    { kind: 'click', point: { x: 1, y: 1 }, button: 'left', count: 1 },
    { kind: 'typeText', ref: 'private-ref', text: 'private value' },
    { kind: 'setValue', ref: 'private-ref', value: 'private value' },
    { kind: 'pressKeys', keys: ['cmd', 'return'] },
  ])('rejects a sequence containing %j rather than silently saving its semantic suffix', action => {
    const result = capture(); result.record(action as any, observation(), receipt, observation(true));
    expect(() => result.finish('Title', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
  });
  it.each(['started', 'unknown', 'notStarted'] as const)('rejects %s dispatch and does not keep an earlier verified prefix', dispatch => {
    const result = capture(); result.record({ kind: 'activate', ref: 'private-ref' }, observation(), { ...receipt, dispatch }, observation(true));
    expect(() => result.finish('Title', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
  });
  it.each(['not_met', 'unavailable', undefined] as const)('requires final native selected evidence: %s', status => {
    const result = new ComputerFlowCapture();
    result.record({ kind: 'activate', ref: 'private-ref' }, observation(), receipt, observation(true), expectation,
      status ? { status, source: 'accessibility', scope: 'expectation' } : undefined);
    expect(() => result.finish('Title', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
  });
  it.each([{ kind: 'text', text: 'Memories' }, { kind: 'field', label: 'Title', value: 'Memories' }])('does not promote %j to navigation evidence', expectation => {
    const result = new ComputerFlowCapture();
    result.record({ kind: 'activate', ref: 'private-ref' }, observation(), receipt, observation(true), expectation as any,
      { status: 'satisfied', source: 'accessibility', scope: 'expectation' });
    expect(() => result.finish('Title', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
  });
  it('admits positive page-specific text from partial native observations without upgrading selected evidence', () => {
    const before = observation(), after = observation(true);
    before.summary = JSON.stringify({ ...JSON.parse(before.summary), truncated: true, text: 'Current page' });
    after.summary = JSON.stringify({ ...JSON.parse(after.summary), truncated: true, text: 'HTML Saving Options' });
    const text = { kind: 'text', text: 'HTML Saving Options' } as const;
    const result = new ComputerFlowCapture();
    result.record({ kind: 'activate', ref: 'private-ref' }, before, receipt, after, text, verifyComputerExpectation(text, after, before));
    expect(result.finish('Page navigation', 'desktop')).toMatchObject({ condition: text, coverage: 'partial' });
    expect(verifyComputerExpectation(expectation, after, before)?.status).toBe('unavailable');
    const old = new ComputerFlowCapture();
    old.record({ kind: 'activate', ref: 'private-ref' }, after, receipt, after, text, verifyComputerExpectation(text, after, after));
    expect(() => old.finish('Already present', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
  });
  it.each(['Memories', 'Memories page'])('rejects a control label as page evidence: %s', text => {
    const before = observation(), after = observation(true);
    before.summary = JSON.stringify({ ...JSON.parse(before.summary), truncated: true, text: 'Current native page' });
    after.summary = JSON.stringify({ ...JSON.parse(after.summary), truncated: true, text });
    const condition = { kind: 'text', text } as const, result = new ComputerFlowCapture();
    result.record({ kind: 'activate', ref: 'private-ref' }, before, receipt, after, condition, verifyComputerExpectation(condition, after, before));
    expect(() => result.finish('Not page evidence', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
  });
  it('rejects truncation, ambiguous labels, web controls, sensitive labels, changed targets and long sequences', () => {
    for (const mutate of [
      (data: any) => { data.truncated = true; },
      (data: any) => { data.elements.push({ ...data.elements[1], ref: 'other-ref' }); },
      (data: any) => { data.elements[1].in_web_content = true; },
      (data: any) => { data.elements[1].label = 'Password'; },
    ]) {
      const before = observation(), data = JSON.parse(before.summary); mutate(data); before.summary = JSON.stringify(data);
      const result = new ComputerFlowCapture();
      result.record({ kind: 'activate', ref: 'private-ref' }, before, receipt, observation(true), expectation,
        { status: 'satisfied', source: 'accessibility', scope: 'expectation' });
      expect(() => result.finish('Title', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
    }
    const result = capture();
    for (let i = 0; i < 12; i++) result.record({ kind: 'activate', ref: 'private-ref' }, observation(), receipt, observation(true), expectation,
      { status: 'satisfied', source: 'accessibility', scope: 'expectation' });
    expect(() => result.finish('Title', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
    const changed = capture(); const after = observation(true); after.target.windowId = 'different';
    changed.record({ kind: 'activate', ref: 'private-ref' }, observation(), receipt, after);
    expect(() => changed.finish('Title', 'desktop')).toThrow('FLOW_NOT_VERIFIED');
  });
});

describe('private durable flow documents', () => {
  it('persists across database reopen, deduplicates and isolates Agent/workspace scopes', () => {
    const path = database(), store = new ComputerFlowStore();
    const saved = store.save('agent/workspace', draft());
    expect(store.save('agent/workspace', draft()).id).toBe(saved.id);
    const original = draft();
    expect(store.save('agent/workspace', { steps: original.steps, condition: original.condition, appId: original.appId, endpointId: original.endpointId, title: ' Open memories ' }).id).toBe(saved.id);
    closeXopcDatabase(); openXopcDatabase({ path });
    expect(new ComputerFlowStore().list('agent/workspace')).toEqual([saved]);
    expect(store.list('other-agent/workspace')).toEqual([]);
    expect(store.delete('other-agent/workspace', saved.id)).toBe(false);
    expect(store.delete('agent/workspace', saved.id)).toBe(true);
    expect(store.list('agent/workspace')).toEqual([]);
  });
  it('deduplicates authenticated device flows across connections without merging legacy or other devices', () => {
    database(); const store = new ComputerFlowStore();
    const first = store.save('scope', { ...draft(), principalId: 'device-one' });
    expect(store.save('scope', { ...draft(), endpointId: 'new-connection', principalId: 'device-one' }).id).toBe(first.id);
    expect(store.save('scope', { ...draft(), principalId: 'device-two' }).id).not.toBe(first.id);
    expect(store.save('scope', draft()).id).not.toBe(first.id);
    expect(store.list('scope')).toHaveLength(3);
  });
  it('caps storage, expires old flows and refuses tampered executable payloads', () => {
    database(); const store = new ComputerFlowStore();
    let first = '';
    for (let i = 0; i < 33; i++) { const item = store.save('scope', { ...draft(), title: `Navigation ${i}` }); if (!i) first = item.id; }
    expect(store.list('scope')).toHaveLength(32);
    expect(store.list('scope').some(item => item.id === first)).toBe(false);
    const saved = store.list('scope')[0];
    expect(ComputerFlowSchema.safeParse({ ...saved, steps: [{ ...saved.steps[0], ref: 'old-ref' }] }).success).toBe(false);
    new DurableState('computer.verified-flows.v1', 'scope').set('tampered', { ...saved, steps: [{ kind: 'typeText', text: 'private' }] });
    expect(store.list('scope')).toHaveLength(32);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 86_400_000);
    expect(store.list('scope')).toEqual([]);
  });
});
