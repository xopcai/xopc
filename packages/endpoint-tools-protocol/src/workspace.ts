import type { EndpointToolDescriptor } from './index.js';

const workspaceId = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' } as const;
const path = { type: 'string', maxLength: 4096 } as const;
const version = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const bytes = { type: 'integer', minimum: 0, maximum: 32768 } as const;
const text = { type: 'string', maxLength: 32768 } as const;
const input = (action: 'read' | 'list' | 'write') => ({ type: 'object', additionalProperties: false,
  required: ['workspaceId', 'relativePath', ...(action === 'write' ? ['text', 'expectedVersion'] : [])],
  properties: { workspaceId, relativePath: path, ...(action === 'write' ? { text, expectedVersion: { anyOf: [version, { type: 'null' }] } } : {}) } });
const output = (action: 'read' | 'list' | 'write') => ({ type: 'array', minItems: 1, maxItems: 1,
  items: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: { type: { const: 'json' }, value: {
    oneOf: [
      { type: 'object', additionalProperties: false, required: ['ok', 'error'], properties: { ok: { const: false }, error: { type: 'string', pattern: '^WORKSPACE_[A-Z_]+$', maxLength: 100 } } },
      { type: 'object', additionalProperties: false, required: ['ok', 'result'], properties: { ok: { const: true }, result: action === 'list'
        ? { type: 'object', additionalProperties: false, required: ['entries', 'truncated'], properties: {
          entries: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['name', 'kind'], properties: { name: { type: 'string', maxLength: 255 }, kind: { enum: ['file', 'directory'] } } } }, truncated: { type: 'boolean' },
        } }
        : { type: 'object', additionalProperties: false, required: ['version', 'bytes', ...(action === 'read' ? ['text'] : [])], properties: { version, bytes, ...(action === 'read' ? { text } : {}) } },
      } },
    ],
  } } } });

export const DESKTOP_WORKSPACE_ACTIONS = ['list', 'read', 'write'] as const;
export type DesktopWorkspaceAction = typeof DESKTOP_WORKSPACE_ACTIONS[number];
export function desktopWorkspaceDescriptor(action: DesktopWorkspaceAction, boundWorkspaceId?: string): EndpointToolDescriptor {
  if (boundWorkspaceId && !new RegExp(workspaceId.pattern).test(boundWorkspaceId)) throw new Error('WORKSPACE_ID_INVALID');
  const write = action === 'write';
  return { name: `desktop.workspace.${action}`, title: `${action} a native-authorized desktop workspace`,
    description: 'Explicit device and workspace only. Relative paths cannot escape the native-selected directory. UTF-8 text is limited to 32768 bytes. Writes require the previously read content version, or null to create a new file. External editor races are not a global CAS; partial writes and unknown outcomes require manual verification.'
      + (boundWorkspaceId ? ` Native-authorized workspace ID: ${boundWorkspaceId}.` : ''),
    inputSchema: input(action), outputSchema: output(action), policyId: write ? 'user.foreground-write' : 'personal.foreground-read',
    sensitivity: 'personal', effect: write ? 'write' : 'read', confirmation: 'always', requiresForeground: true,
    requiredPermissions: [write ? 'workspace-write' : 'workspace-read'], timeoutMs: 60000, maxConcurrency: 1, supportsCancellation: true,
    idempotent: !write, resultKinds: ['json'] };
}
