import { describe, expect, it } from 'vitest';

import { EndpointTaskTargetService, type EndpointExecutionTarget } from '../task-targets.js';
import type { EndpointConnectionSnapshot, EndpointRegistry } from '../registry.js';

function fixture() {
  const endpoint = { endpointId: 'mac', principalId: 'device', connectionId: 'epoch-1' } as EndpointConnectionSnapshot;
  const state = { endpoint: endpoint as EndpointConnectionSnapshot | undefined, transcript: 'transcript-1', actor: 'owner' };
  const store = new Map<string, EndpointExecutionTarget>();
  const open = () => new EndpointTaskTargetService({ get: () => state.endpoint } as unknown as EndpointRegistry,
    () => state.transcript, () => state.actor, store);
  return { state, targets: open(), reopen: open };
}

describe('task execution targets', () => {
  it('keeps the selected identity after restart without restoring connection authority', () => {
    const { state, targets, reopen } = fixture();
    const old = targets.select('conversation', 'mac');
    state.endpoint = { ...state.endpoint!, connectionId: 'new-epoch' };
    const restarted = reopen();
    expect(restarted.get('conversation')?.executionRef).toBe(old.executionRef);
    expect(restarted.resolve('conversation')).toBeUndefined();
    expect(restarted.select('conversation', 'mac').connectionId).toBe('new-epoch');
  });

  it('blocks target replacement and release until every active resource confirms stop', () => {
    const { targets } = fixture();
    const target = targets.select('conversation', 'mac');
    const closeComputer = targets.hold('conversation', 'computer');
    const closeBrowser = targets.hold('conversation', 'browser');
    expect(targets.select('conversation', 'mac').executionRef).toBe(target.executionRef);
    expect(() => targets.clear('conversation')).toThrow('TARGET_RESOURCE_BUSY');
    expect(() => targets.select('conversation', 'mac', Date.now(), 'another-actor')).toThrow('TARGET_RESOURCE_BUSY');
    closeComputer();
    expect(() => targets.clear('conversation')).toThrow('TARGET_RESOURCE_BUSY');
    closeBrowser();
    const newResource = targets.hold('conversation', 'new-resource');
    closeBrowser();
    expect(() => targets.clear('conversation')).toThrow('TARGET_RESOURCE_BUSY');
    newResource();
    expect(targets.clear('conversation')).toBe(true);
  });
  it('pins an actor, transcript and connection without silently switching after reconnect', () => {
    const { targets, state } = fixture();
    const selected = targets.select(' conversation ', 'mac', Date.now(), 'owner');
    expect(selected).toMatchObject({ conversationId: 'conversation', endpointId: 'mac', principalId: 'device', connectionId: 'epoch-1' });
    expect(targets.resolve('conversation')).toBe(state.endpoint);
    state.actor = 'another-device';
    expect(targets.resolve('conversation')).toBeUndefined();
    state.actor = 'owner';
    state.endpoint = { ...state.endpoint!, connectionId: 'epoch-2' };
    expect(targets.resolve('conversation')).toBeUndefined();
    expect(targets.get('conversation')?.executionRef).toBe(selected.executionRef);
    state.transcript = 'transcript-2';
    expect(targets.get('conversation')).toBeUndefined();
  });
  it('retains an expired target as unavailable and requires explicit reselection', () => {
    const { targets, state } = fixture();
    targets.select('conversation', 'mac', 0);
    expect(targets.resolve('conversation')).toBeUndefined();
    expect(targets.get('conversation')?.endpointId).toBe('mac');
    state.endpoint = undefined;
    expect(() => targets.select('conversation', 'mac')).toThrow('TARGET_OFFLINE');
    expect(targets.clear('conversation')).toBe(true);
    expect(targets.get('conversation')).toBeUndefined();
  });
});
