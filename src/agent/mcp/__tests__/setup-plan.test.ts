import { expect, it } from 'vitest';
import { connectionPlanSchema, localExecutionSchema, secretFieldsSchema } from '../setup-plan.js';

it('canonicalizes a documented Bearer field and rejects ambiguous credentials', () => {
  const base = { displayName: 'Docs', url: 'https://docs.example/mcp', authentication: 'bearer', objective: 'complete_task' };
  const field = { id: 'access', label: 'Token', location: 'header', name: 'Authorization' };
  expect(connectionPlanSchema.parse({ ...base, secretFields: [field] }).secretFields[0].prefix).toBe('Bearer ');
  expect(() => connectionPlanSchema.parse({ ...base, secretFields: [{ ...field, name: 'X-API-Key' }] })).toThrow();
  expect(() => secretFieldsSchema.parse([field, { ...field, id: 'another' }])).toThrow();
  expect(() => secretFieldsSchema.parse([{ ...field, name: 'Host' }])).toThrow();
});
it('requires a concrete pinned package execution and rejects shell, control characters and sensitive arguments', () => {
  const base = { command: 'npx', args: ['--yes', '@example/server@1.2.3'], sourceUrl: 'https://docs.example/stdio' };
  expect(localExecutionSchema.parse(base).args).toEqual(base.args);
  for (const args of [['server@latest'], ['server'], ['server@1.2.3', '--token=private'], ['server@1.2.3', '\n']]) expect(() => localExecutionSchema.parse({ ...base, args })).toThrow();
  expect(() => localExecutionSchema.parse({ ...base, command: '/bin/sh', args: ['-c', 'echo hello'] })).toThrow();
  expect(() => secretFieldsSchema.parse([{ id: 'runtime', label: 'Runtime', location: 'env', name: 'NODE_OPTIONS' }])).toThrow();
});
