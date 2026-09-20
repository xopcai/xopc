import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const id = Type.String({ minLength: 1, maxLength: 48, pattern: '^[a-zA-Z0-9_-]+$' });
const path = Type.String({ minLength: 1, maxLength: 1024 });
export const DataBatchSchema = Type.Object({
  operations: Type.Array(Type.Union([
    Type.Object({ id, kind: Type.Literal('file_read'), path,
      startLine: Type.Optional(Type.Integer({ minimum: 1 })),
      maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    }, { additionalProperties: false }),
    Type.Object({ id, kind: Type.Literal('file_search'),
      paths: Type.Array(path, { minItems: 1, maxItems: 8 }),
      patterns: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { minItems: 1, maxItems: 8 }),
      literal: Type.Optional(Type.Boolean()), ignoreCase: Type.Optional(Type.Boolean()),
      glob: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      contextLines: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
    }, { additionalProperties: false }),
    Type.Object({ id, kind: Type.Literal('git_recent'), paths: Type.Optional(Type.Array(path, { minItems: 1, maxItems: 8 })),
      since: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })), until: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
    }, { additionalProperties: false }),
    Type.Object({ id, kind: Type.Literal('git_read'), path, commit: Type.String({ pattern: '^[a-fA-F0-9]{7,64}$' }) }, { additionalProperties: false }),
    Type.Object({ id, kind: Type.Literal('knowledge_search'), query: Type.String({ minLength: 1, maxLength: 1000 }),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    }, { additionalProperties: false }),
    Type.Object({ id, kind: Type.Literal('knowledge_get'), knowledgeId: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
    Type.Object({ id, kind: Type.Literal('web_search'), query: Type.String({ minLength: 1, maxLength: 1000 }),
      count: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }, { additionalProperties: false }),
    Type.Object({ id, kind: Type.Literal('web_fetch'), url: Type.String({ minLength: 1, maxLength: 2048 }),
      maxChars: Type.Optional(Type.Integer({ minimum: 100, maximum: 12000 })),
    }, { additionalProperties: false }),
    Type.Object({ id, kind: Type.Literal('external_read'), toolRef: Type.String({ minLength: 1, maxLength: 512 }),
      revision: Type.String({ minLength: 1, maxLength: 128 }),
      arguments: Type.Record(Type.String(), Type.Unknown()),
    }, { additionalProperties: false }),
  ]), { minItems: 1, maxItems: 8 }),
}, { additionalProperties: false });

export type DataBatchArgs = Static<typeof DataBatchSchema>;
export type DataOperation = DataBatchArgs['operations'][number];
export const DATA_OPERATION_TOOLS = { file_read: 'read_file', file_search: 'grep', git_recent: 'exec_command', git_read: 'exec_command',
  knowledge_search: 'knowledge_search', knowledge_get: 'knowledge_get', web_search: 'web_search', web_fetch: 'web_fetch', external_read: 'xopc_tool_execute' } as const;

export function nativeDataArgs(op: DataOperation): Record<string, unknown> {
  switch (op.kind) {
    case 'knowledge_search': return { query: op.query, maxResults: op.maxResults };
    case 'knowledge_get': return { id: op.knowledgeId };
    case 'web_search': return { query: op.query, count: op.count };
    case 'web_fetch': return { url: op.url, maxChars: op.maxChars ?? 8000 };
    case 'external_read': return { toolRef: op.toolRef, revision: op.revision, arguments: op.arguments, readOnly: true };
    default: throw new Error('Not a native data operation');
  }
}

/** Expose each underlying access to existing approval, hook and call-limit policies. */
export function dataOperationCalls(args: unknown): Array<{ name: string; args: Record<string, unknown> }> {
  validateDataBatch(args);
  return args.operations.flatMap<{ name: string; args: Record<string, unknown> }>(op => {
    if (op.kind === 'file_read') return [{ name: 'read_file', args: { path: op.path, offset: op.startLine, limit: op.maxLines } }];
    if (op.kind === 'file_search') return op.paths.flatMap(path => op.patterns.map(pattern => ({ name: 'grep',
      args: { path, pattern, literal: op.literal, glob: op.glob, ignoreCase: op.ignoreCase, context: op.contextLines ?? 2 } })));
    if (op.kind === 'git_read' || op.kind === 'git_recent') return [
      { name: 'exec_command', args: { cmd: op.kind === 'git_read' ? `git show ${op.commit} (file read)` : 'git log HEAD (recent history)', ...op } },
      ...(op.kind === 'git_read' ? [{ name: 'read_file', args: { path: op.path } }] : []),
    ];
    return [{ name: DATA_OPERATION_TOOLS[op.kind], args: nativeDataArgs(op) }];
  });
}

export function validateDataBatch(args: unknown): asserts args is DataBatchArgs {
  if (!Value.Check(DataBatchSchema, args)) throw new Error('Invalid data_batch parameters');
  if (new Set(args.operations.map(op => op.id)).size !== args.operations.length) throw new Error('Operation ids must be unique');
  if (Buffer.byteLength(JSON.stringify(args)) > 32_000) throw new Error('Batch input exceeds 32 KB');
}
