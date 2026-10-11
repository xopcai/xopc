import type { AgentTool, BeforeToolCallContext } from '@earendil-works/pi-agent-core';
import { createHash } from 'node:crypto';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export type XopcToolMetadata = Pick<ToolDefinition, 'exposure' | 'namespace' | 'annotations' | 'outputSchema'> & {
  external?: { toolRef: string; revision: string; readOnly: boolean };
  subscribeInvalidation?: (listener: () => void) => () => void;
};
const metadataKey = Symbol('xopc.sdkToolMetadata');

export function setXopcToolMetadata(tool: AgentTool, metadata: XopcToolMetadata): AgentTool {
  return Object.assign(tool, { [metadataKey]: metadata });
}

export function getXopcToolMetadata(tool: AgentTool): XopcToolMetadata | undefined {
  return Reflect.get(tool, metadataKey);
}

export function deferredToolContract(tool: AgentTool): string {
  return createHash('sha256').update(JSON.stringify([tool.name, tool.description, tool.parameters, getXopcToolMetadata(tool)])).digest('base64url');
}

/** Deferred declarations retain the policy identity of the existing external gateway. */
export function externalPolicyContext(context: BeforeToolCallContext, tools: readonly AgentTool[]): BeforeToolCallContext {
  const tool = tools.find(candidate => candidate.name === context.toolCall.name);
  const external = tool && getXopcToolMetadata(tool)?.external;
  if (!external) return context;
  const args = { ...external, arguments: context.args as BeforeToolCallContext['toolCall']['arguments'] };
  return { ...context, args, toolCall: { ...context.toolCall, name: 'xopc_tool_execute', arguments: args } };
}
