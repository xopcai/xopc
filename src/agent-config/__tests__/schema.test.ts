import { describe, expect, it } from 'vitest';

import { AgentsConfigSchema } from '../schema.js';

describe('AgentsConfigSchema', () => {
  it('creates one valid default agent configuration', () => {
    const result = AgentsConfigSchema.parse({});

    expect(result.default).toBe('main');
    expect(result.list).toEqual([{ id: 'main', enabled: true }]);
    expect(result.defaults.models.chat.primary).toContain('/');
  });

  it('rejects duplicate ids and an unavailable default agent', () => {
    const result = AgentsConfigSchema.safeParse({
      default: 'missing',
      list: [{ id: 'main' }, { id: 'main' }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'duplicate agent id "main"',
      'default agent "missing" must reference an enabled entry',
    ]));
  });
});
