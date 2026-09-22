import { describe, expect, it } from 'vitest';
import { ExtensionCapabilityBindingsSchema, extensionCapabilityPermissions } from './extension-capabilities.js';

const binding = { id: 'xopc.notes.get', majorVersion: 1, descriptorDigest: 'a'.repeat(64) };
describe('extension capability bindings', () => {
  it('preserves exact host contracts and derives visible permission labels', () => {
    const parsed = ExtensionCapabilityBindingsSchema.parse([binding]);
    expect(parsed).toEqual([binding]);
    expect(extensionCapabilityPermissions(parsed)).toEqual(['capability:xopc.notes.get']);
  });
  it.each([
    [binding, binding], [{ ...binding, id: 'xopc.notes.delete' }], [{ ...binding, id: 'xopc.*' }],
    [{ ...binding, majorVersion: 0 }], [{ ...binding, descriptorDigest: 'latest' }], [{ ...binding, code: 'execute()' }],
    [{ ...binding, principalId: 'admin' }],
  ])('rejects unsupported, duplicate or authority-bearing declarations: %j', (...bindings) => {
    expect(ExtensionCapabilityBindingsSchema.safeParse(bindings).success).toBe(false);
  });
});
