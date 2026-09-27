import { expect, it } from 'vitest';
import { isSessionCommandRejected } from '../session-command-rejection.js';

it('unfreezes only explicit pre-acceptance failures', () => {
  expect(isSessionCommandRejected(400, { error: { code: 'BAD_REQUEST' } })).toBe(true);
  expect(isSessionCommandRejected(409, { error: { code: 'CONFIG_CHANGED' } })).toBe(true);
  for (const [status, body] of [[500, { error: { code: 'BAD_REQUEST' } }], [409, { error: { code: 'IDEMPOTENCY_CONFLICT' } }], [400, null], [401, {}]] as const) {
    expect(isSessionCommandRejected(status, body)).toBe(false);
  }
});
