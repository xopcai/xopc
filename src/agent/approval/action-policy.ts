import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { ActionApprovalMode } from '@xopcai/gateway-contract';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { connectorArgumentsHash } from '../../connectors/approval.js';
import { dataOperationCalls } from '../data-acquisition/schema.js';

const coreIdentity = Symbol('xopc.actionApproval.core');
const LOCAL_READS = new Set(['read_file', 'list_dir', 'grep', 'find']);
const LOCAL_ACTIONS = new Set(['clarify', 'tool_search', 'xopc_tool_search', 'xopc_tool_describe',
  'knowledge_search', 'knowledge_get', 'knowledge_read', 'user_context_read', 'personal_read', 'session_recall', 'session_search', 'personal_result']);
const WRAPPERS = new Set(['codemode']);

/** Called by the core factory before plugin tools are merged. */
export function markActionApprovalCore<T extends object>(tool: T): T {
  Object.assign(tool, { [coreIdentity]: true });
  return tool;
}

export function isActionApprovalCore(tool: AgentTool | undefined): boolean {
  return tool !== undefined && Reflect.get(tool, coreIdentity) === true;
}

function workspacePath(path: unknown, workspace: string): boolean {
  if (typeof path !== 'string') return false;
  try {
    const root = realpathSync(workspace);
    const target = realpathSync(resolve(root, path));
    const rel = relative(root, target);
    return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  } catch { return false; }
}

export type ActionPolicyInput = {
  name: string;
  args: unknown;
  workspace: string;
  core: boolean;
  mode: ActionApprovalMode;
  policy?: { mode: 'allow' | 'ask' | 'deny'; readOnly?: boolean };
};

/** Unknown capabilities never enter the deterministic read fast path. */
export function requiresActionApproval(input: ActionPolicyInput): boolean {
  if (input.policy?.mode === 'ask') return true;
  if (input.mode === 'full') return false;
  const args = input.args && typeof input.args === 'object' ? input.args as Record<string, unknown> : {};
  if (input.core) {
    if (LOCAL_ACTIONS.has(input.name) || WRAPPERS.has(input.name)) return false;
    if (LOCAL_READS.has(input.name)) return !workspacePath(args.path ?? '.', input.workspace);
    // The patch tool itself enforces workspace containment; arbitrary shell never qualifies.
    if (input.name === 'apply_patch') return typeof args.patch !== 'string' || /^\*\*\* Delete File:/m.test(args.patch);
    if (input.name === 'data_batch') return dataOperationCalls(input.args).some(call => requiresActionApproval({
      ...input, name: call.name, args: call.args, policy: undefined,
    }));
  }
  return true;
}

export function actionApprovalKey(input: {
  toolName: string; args: unknown; workspace: string; mode: ActionApprovalMode;
  agentId: string; policy: unknown; binding?: unknown;
}): string {
  return connectorArgumentsHash(input);
}
