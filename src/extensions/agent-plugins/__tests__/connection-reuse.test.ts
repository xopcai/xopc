import { expect, it } from 'vitest';
import { ConfigSchema } from '../../../config/schema.js';
import { connectionFingerprint, matchingReusableConnection, validPluginOAuthReference } from '../connection-reuse.js';

it('requires the same endpoint and OAuth contract and an explicit host credential identity', () => {
  const target = { type: 'streamable-http' as const, url: 'https://example.com/mcp', oauth: { scope: 'read' } };
  const source = { url: target.url, oauth: { scope: 'read' }, xopcOAuthCredentialId: `mcp_draft_${'a'.repeat(32)}` };
  expect(matchingReusableConnection(target, source)).toBe(true);
  for (const change of [{ url: 'https://other.example/mcp' }, { oauth: { scope: 'read write' } }, { headers: { Authorization: 'Bearer fixture' } }, { enabled: false }, { xopcOAuthCredentialId: undefined }]) expect(matchingReusableConnection(target, { ...source, ...change })).toBe(false);
  const config = ConfigSchema.parse({ mcp: { servers: { docs: source } } });
  const reference = { sourceServerId: 'docs', credentialId: source.xopcOAuthCredentialId, fingerprint: connectionFingerprint(config.mcp!.servers!.docs) };
  expect(validPluginOAuthReference(reference, config)).toBe(true);
  config.mcp!.servers!.docs.oauth = { scope: 'write' };
  expect(validPluginOAuthReference(reference, config)).toBe(false);
});
