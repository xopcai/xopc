import type { EndpointToolDescriptor } from './index.js';

export const DESKTOP_COMMAND_ARGV_BYTES = 4000;
export function desktopCommandDescriptor(workspaceId?: string, imageId?: string): EndpointToolDescriptor {
  if (workspaceId && !/^[a-f0-9-]{36}$/.test(workspaceId) || imageId && !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('DESKTOP_COMMAND_BINDING_INVALID');
  return {
    name: 'desktop.command.run', title: 'Run a command in the authorized local Docker workspace',
    description: 'Explicit device and isolated Docker workspace only. Structured argv JSON must be at most 4000 UTF-8 bytes. A fresh native approval is required for every command. The container has no network, host directory mounts or host credentials. Programs run inside the installed image as a non-root user. The owned volume can retain effects even after interruption; unknown outcomes must never be retried automatically. A nonzero exit code is still a completed command with possible effects.'
      + (workspaceId ? ` Authorized workspace ID: ${workspaceId}.` : '') + (imageId ? ` Immutable image: ${imageId}.` : ''),
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceId', 'argv'], properties: {
      workspaceId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
      argv: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string', maxLength: 4000 } },
    } },
    outputSchema: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: {
      type: { const: 'json' }, value: { type: 'object', additionalProperties: false, required: ['exitCode', 'stdout', 'stderr', 'truncated'], properties: {
        exitCode: { type: 'integer' }, stdout: { type: 'string', maxLength: 16384 }, stderr: { type: 'string', maxLength: 16384 }, truncated: { type: 'boolean' },
      } },
    } } },
    policyId: 'user.foreground-write', sensitivity: 'personal', effect: 'write', confirmation: 'always', requiresForeground: true,
    requiredPermissions: ['container-command'], timeoutMs: 60000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: ['json'],
  };
}
