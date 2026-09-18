import { describe, expect, it } from 'vitest';

import { validateExtensionConfig } from '../config-validation.js';

const schema = {
  type: 'object',
  properties: {
    endpoint: { type: 'string', pattern: '^https://' },
    retries: { type: 'integer', minimum: 0, maximum: 5 },
  },
  required: ['endpoint'],
  additionalProperties: false,
};

describe('validateExtensionConfig', () => {
  it('applies the complete JSON Schema', () => {
    expect(validateExtensionConfig(schema, { endpoint: 'https://example.com', retries: 2 })).toEqual({ valid: true });
    expect(validateExtensionConfig(schema, { endpoint: 'http://example.com' }).valid).toBe(false);
    expect(validateExtensionConfig(schema, { endpoint: 'https://example.com', extra: true }).valid).toBe(false);
  });

  it('rejects malformed schemas', () => {
    expect(validateExtensionConfig({ type: 'unknown-json-schema-type' }, {}).valid).toBe(false);
  });
});
