import { Type } from '@sinclair/typebox';
import { z } from 'zod';
import { ComputerActionSchema } from '@xopcai/computer-control-contract';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { ComputerUseInputSchema, type ComputerRuntime } from '../../computer/runtime.js';
import type { GatewayClarifyRequestFn } from './clarify-tool.js';

const Schema = Type.Object({
  op: Type.Union(['open', 'observe', 'step', 'act', 'close'].map(op => Type.Literal(op))),
  appId: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'Required only for op=open: exact application bundle ID explicitly supplied by the user.' })),
  goal: Type.Optional(Type.String({ minLength: 1, maxLength: 4000, description: 'Required only for op=step: the next concrete GUI goal.' })),
  observationId: Type.Optional(Type.String()),
  action: Type.Optional(Type.Unsafe(z.toJSONSchema(ComputerActionSchema))),
}, { additionalProperties: false });
export function createComputerUseTool(deps: {
  runtime: ComputerRuntime;
  context(): { conversationId: string; runId: string };
  requestClarification: GatewayClarifyRequestFn;
}): AgentTool {
  return {
    name: 'computer_use', label: 'Computer', parameters: Schema,
    description: 'Control one explicitly authorized desktop application. Exact calls: open {op:"open",appId:"user supplied bundle ID"}; observe {op:"observe"}; step {op:"step",goal:"next GUI goal"}; close {op:"close"}. Do not include appId on other operations. Step predicts at most one GUI action and may suspend for local approval. Act requires an observationId and an action grounded in that observation, never guessed coordinates. Screenshots stay out of the transcript. Never bypass a refusal using shell/MCP. Model-finished is not verified success: observe and verify the actual outcome, then close.',
    async execute(toolCallId, raw, signal) {
      const input = ComputerUseInputSchema.parse(raw);
      const context = deps.context();
      let result = await deps.runtime.execute(context.conversationId, input, signal);
      if (result.pending) {
        const answer = await deps.requestClarification({ ...context, toolCallId }, {
          question: 'Computer Use 已暂停。请先在 xopc 桌面端完成本机授权或手动操作，再点击继续。此处继续不会授予桌面权限。',
          choices: ['已在桌面端处理，继续', '停止电脑操作'],
          approvalKey: `computer:${result.sessionId}`,
        }).catch(async error => { await deps.runtime.close(context.conversationId); throw error; });
        if (answer.status === 'answered' && answer.answer !== '已在桌面端处理，继续') {
          await deps.runtime.close(context.conversationId);
          result = { status: 'stopped', sessionId: result.sessionId };
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  };
}
