import { createHash } from 'node:crypto';

import Ajv from 'ajv';

import type { ProcessResult } from '../../process/process-spec.js';
import type { CliAction, CliAdapter, CliResult, JsonObject } from './types.js';

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, ownProperties: true });

export class CliProtocolError extends Error {}

export function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliProtocolError('Expected a JSON object.');
  return value as JsonObject;
}

export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export function actionRevision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function validateActionInput(action: CliAction, input: JsonObject): void {
  const validate = ajv.compile(action.inputSchema);
  if (!validate(input)) throw new Error(`Invalid action input: ${ajv.errorsText(validate.errors)}`);
}

export function normalizeCliResult(adapter: Pick<CliAdapter, 'decodeResult'>, output: ProcessResult, scope: CliAction['scope']): CliResult {
  const uncertain = scope !== 'read' && !output.spawnErrorCode;
  if (output.timedOut || output.aborted || output.spawnErrorCode || output.outputTruncated) {
    const kind = output.timedOut ? 'timeout' : output.aborted ? 'cancelled' : output.spawnErrorCode ? 'startup' : 'protocol';
    return { outcome: uncertain ? 'unknown' : 'failed', error: { kind, message: `CLI execution ${kind}.` } };
  }
  try {
    const data = adapter.decodeResult(output);
    if (output.exitCode !== 0) throw new Error('CLI exited unsuccessfully.');
    return { outcome: 'success', data };
  } catch (error) {
    const protocolError = error instanceof SyntaxError || error instanceof CliProtocolError;
    return {
      outcome: uncertain && (protocolError || output.signal !== null) ? 'unknown' : 'failed',
      error: { kind: protocolError ? 'protocol' : 'provider', message: error instanceof Error ? error.message : 'CLI failed.' },
    };
  }
}

export function closedSchema(value: unknown): JsonObject {
  const schema = structuredClone(object(value));
  if (schema.type !== 'object') throw new Error('Action input must be an object schema.');
  schema.additionalProperties = false;
  ajv.compile(schema);
  return schema;
}
