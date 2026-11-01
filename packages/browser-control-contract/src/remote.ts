import type { BrowserActionInput } from './index.js';

export const REMOTE_BROWSER_CONTROL_TOOL = 'desktop.browser.control';
export const REMOTE_BROWSER_FRAME_MAX_BYTES = 5 * 1024 * 1024;

type DistributedOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Device selection belongs to the authenticated endpoint, never to a browser command or server path. */
export type RemoteBrowserInput = DistributedOmit<Exclude<BrowserActionInput, { action: 'upload' | 'sequence' }>, 'target' | 'sessionId'>;
export interface RemoteBrowserCommand {
  version: 1;
  owner: string;
  sessionId: string;
  actionId: string;
  input: RemoteBrowserInput;
}

const text = (maxLength: number) => ({ type: 'string', maxLength });
const id = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9:_-]+$' };
const actionId = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const revision = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const url = { type: 'string', minLength: 1, maxLength: 4096, pattern: '^https?://[^\\s]+$' };
const expectation = { type: 'object', additionalProperties: false, properties: {
  urlIncludes: text(1024), titleIncludes: text(1024), textIncludes: text(1024), ref: id, state: { enum: ['visible', 'hidden'] },
} };
const target = { type: 'object', additionalProperties: false, required: ['role'], properties: {
  role: { type: 'string', minLength: 1, maxLength: 100 }, name: text(240), nameIncludes: text(240), testId: text(240),
  scope: { type: 'object', additionalProperties: false, required: ['role', 'name'], properties: { role: text(100), name: text(240) } },
} };
const action = (name: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object', additionalProperties: false, required: ['action', ...required], properties: { action: { const: name }, ...properties },
});

/** Reuses Browser actions with a bounded envelope; host-path upload and unreviewed action batches are excluded. */
export const REMOTE_BROWSER_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['version', 'owner', 'sessionId', 'actionId', 'input'],
  properties: { version: { const: 1 }, owner: id, sessionId: id, actionId,
    input: { oneOf: [
      action('observe', { visual: { enum: ['never', 'auto', 'always'] } }),
      action('navigate', { url, expect: expectation }, ['url']),
      action('resolve', { semanticTarget: target }, ['semanticTarget']),
      action('click', { revision, ref: id, expect: expectation }, ['revision', 'ref']),
      action('fill', { revision, ref: id, value: text(4096), submit: { type: 'boolean' }, expect: expectation }, ['revision', 'ref', 'value']),
      action('select', { revision, ref: id, value: text(4096), expect: expectation }, ['revision', 'ref', 'value']),
      action('check', { revision, ref: id, checked: { type: 'boolean' } }, ['revision', 'ref', 'checked']),
      action('press', { revision, ref: id, key: { type: 'string', minLength: 1, maxLength: 100 }, expect: expectation }, ['revision', 'key']),
      action('scroll', { revision, ref: id, deltaY: { type: 'number', minimum: -10000, maximum: 10000 }, expect: expectation }, ['revision', 'deltaY']),
      action('wait', { revision, ref: id, condition: { enum: ['page_idle', 'text', 'visible', 'hidden'] }, value: text(1024),
        timeoutMs: { type: 'integer', minimum: 0, maximum: 5000 } }, ['revision', 'condition']),
      action('tabs', { operation: { const: 'list' } }, ['operation']),
      action('tabs', { operation: { const: 'create' }, url }, ['operation']),
      action('tabs', { operation: { enum: ['activate', 'close'] }, tabId: id }, ['operation', 'tabId']),
      action('close'),
    ] },
  },
};
export const REMOTE_BROWSER_OUTPUT_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 2, items: { oneOf: [
    { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: { type: { const: 'json' }, value: { type: 'object' } } },
    { type: 'object', additionalProperties: false, required: ['type', 'fileId', 'name', 'mimeType', 'size', 'sha256'], properties: {
      type: { const: 'file' }, fileId: { type: 'string' }, name: { type: 'string' }, mimeType: { enum: ['image/png', 'image/jpeg'] },
      size: { type: 'integer', minimum: 1, maximum: REMOTE_BROWSER_FRAME_MAX_BYTES }, sha256: { type: 'string' },
    } },
  ] },
};
export const REMOTE_BROWSER_DESCRIPTOR = {
  name: REMOTE_BROWSER_CONTROL_TOOL, title: 'Remote Browser control transport',
  description: 'Private native-approved device browser transport. Use browser_use instead.',
  inputSchema: REMOTE_BROWSER_INPUT_SCHEMA, outputSchema: REMOTE_BROWSER_OUTPUT_SCHEMA,
  policyId: 'browser.remote-session-scoped', sensitivity: 'personal', effect: 'write',
  confirmation: 'always', requiresForeground: true, requiredPermissions: ['browser-control'],
  timeoutMs: 30_000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: ['json', 'file'],
} as const;
