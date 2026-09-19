import type { ProcessResult } from '../../process/process-spec.js';
import type { ConnectorScope } from '../types.js';

export type JsonObject = Record<string, unknown>;
export type CliAction = {
  id: string;
  description: string;
  inputSchema: JsonObject;
  scope: ConnectorScope;
  requiredScopes: string[];
  anyScopes?: string[];
  revision: string;
};
export type CliIdentity = { key: string; label: string; scopes: string[]; identity: JsonObject };
export type CliChallenge = ({ type: 'open_url'; url: string } | { type: 'qr_code'; artifactId: string }) & { step: number; totalSteps: number };
export type CliResult = {
  outcome: 'success' | 'failed' | 'unknown';
  data?: unknown;
  error?: { kind: 'protocol' | 'provider' | 'timeout' | 'cancelled' | 'startup' | 'unauthorized'; message: string; code?: string };
};
export type CliDistribution = {
  url: string;
  integrity: string;
  archiveEntry: string;
};
export type CliAdapter = {
  id: string;
  version: string;
  binaryVersion: string;
  executable: string;
  distributions: Record<string, CliDistribution>;
  configEnvironment: string;
  dataEnvironment?: string;
  curatedActions: Record<string, ConnectorScope>;
  staticActions?: Record<string, CliAction>;
  schemaArgs(actionId: string): string[];
  decodeSchema(actionId: string, value: unknown): CliAction;
  actionArgs(action: CliAction, input: JsonObject): string[];
  decodeResult(output: ProcessResult): unknown;
  statusArgs: string[];
  decodeIdentity(output: ProcessResult): CliIdentity;
  authorizationSteps: Array<{
    args: string[];
    challenge: 'url' | 'qr';
    initialOnly?: boolean;
    decodeResult?: (output: ProcessResult) => void;
    urlHosts?: string[];
    urlField?: string;
  }>;
};
