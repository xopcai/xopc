import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { locationDescriptor } from '@xopcai/endpoint-tools-protocol';
import { EndpointRegistry } from '../registry.js';
import { EndpointBindingService } from '../binding-service.js';
import { DeviceTargetResolver } from '../target-resolver.js';
import { DeviceGrantService } from '../grant-service.js';
function fixture() {
  let now = 100_000; const registry = new EndpointRegistry();
  const connect = (id: string) => registry.register({ principalId: id, endpointId: id, connectionInstanceId: randomUUID(),
    displayName: 'Same name', kind: 'mobile', platform: 'ios', appVersion: '1', availability: 'foreground',
    nonce: randomUUID(), signedAt: Date.now(), signature: 'fixture', tools: [locationDescriptor('mobile')] }, randomUUID(), { readyState: 1, send: () => {}, close: () => {} });
  connect('source'); connect('target'); const grants = new DeviceGrantService(registry, () => now);
  const resolver = new DeviceTargetResolver(registry, new EndpointBindingService(registry), grants);
  const origin = { type: 'endpoint' as const, endpointId: 'source' };
  const input = { conversationId: 'chat', requestorPrincipalId: 'source', targetEndpointId: 'target', toolName: 'mobile.device.get_location', arguments: { purpose: 'weather', precision: 'approximate' } };
  return { registry, grants, resolver, origin, input, connect, advance: () => { now += 60_001; } };
}
describe('single-call device grants', () => {
  it('exposes only the approved target capability to the approved source and conversation', () => {
    const { grants, resolver, origin, input } = fixture();
    expect(resolver.resolve('chat', origin, 'target', input.toolName)).toBeUndefined(); grants.issue(input);
    expect(resolver.resolve('chat', origin, 'target', input.toolName)?.principalId).toBe('target');
    expect(resolver.resolve('other', origin, 'target', input.toolName)).toBeUndefined();
    expect(resolver.resolve('chat', { type: 'system', source: 'cli' }, 'target', input.toolName)).toBeUndefined();
    expect(resolver.resolve('chat', origin, 'target', 'mobile.file.share')).toBeUndefined(); grants.close();
  });
  it('refuses resource or precision expansion, duplicate use and use after revoke', () => {
    const { grants, input } = fixture(); const grant = grants.issue(input);
    expect(() => grants.reserve(grant.id, { ...input.arguments, precision: 'precise' })).toThrow('scope');
    const lease = grants.reserve(grant.id, input.arguments); expect(() => grants.reserve(grant.id, input.arguments)).toThrow('consumed');
    grants.revoke(grant.id); expect(lease.signal.aborted).toBe(true); lease.complete();
  });
  it('invalidates on expiry and reconnect, without substituting a same-name device', () => {
    const { grants, input, advance, connect } = fixture(); const old = grants.issue(input); connect('target');
    expect(() => grants.reserve(old.id, input.arguments)).toThrow('expired');
    const current = grants.issue(input); advance(); expect(() => grants.reserve(current.id, input.arguments)).toThrow('expired'); grants.close();
  });
});
