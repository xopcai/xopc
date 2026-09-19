import { actionRevision, closedSchema } from '../protocol.js';
import type { CliAction, JsonObject } from '../types.js';

// Shortcuts do not expose `schema`; these contracts are pinned to lark-cli 1.0.96.
const schemas: Record<string, { description: string; properties: JsonObject; required: string[] }> = {
  'docs.search': { description: 'Search visible Lark documents. Pass the returned page token to retrieve the next page.', required: ['query'], properties: {
    query: { type: 'string', minLength: 1 }, page_size: { type: 'integer', minimum: 1, maximum: 20 }, page_token: { type: 'string' },
  } },
  'docs.fetch': { description: 'Read a Lark document by URL or token, optionally restricting content to its outline.', required: ['doc'], properties: {
    doc: { type: 'string', minLength: 1 }, scope: { type: 'string', enum: ['full', 'outline'] },
  } },
};
export const larkShortcuts: Record<string, CliAction> = Object.fromEntries(Object.entries(schemas).map(([id, schema]) => {
  const inputSchema = closedSchema({ type: 'object', properties: schema.properties, required: schema.required });
  return [id, { id, description: schema.description, inputSchema, scope: 'read', requiredScopes: [], revision: actionRevision({ version: '1.0.96', id, inputSchema }) }];
}));

export function larkShortcutArgs(action: CliAction, input: JsonObject): string[] {
  const args = ['docs', action.id === 'docs.search' ? '+search' : '+fetch', '--as', 'user'];
  if (action.id === 'docs.search') args.push('--format', 'json');
  for (const [key, value] of Object.entries(input)) args.push(`--${key.replaceAll('_', '-')}`, String(value));
  return args;
}
