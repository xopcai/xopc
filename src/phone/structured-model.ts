import { performance } from 'node:perf_hooks';

import { completeSimple, type Api, type Model, type Tool } from '@earendil-works/pi-ai/compat';
import { z } from 'zod';

import { PhoneDecisionSchema, PhoneError, type PhoneDecision } from './contracts.js';
import type { PhoneModelMetric } from './execution-trace.js';
import type { PhonePrediction } from './model-adapter.js';

const TOOL_NAME = 'phone_decision';
const invalid = () => new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model returned an invalid or incomplete function call; no action was dispatched');

/** Use the shared provider client for API keys and ChatGPT OAuth without persisting screenshots. */
export async function predictPhoneToolDecision(model: Model<Api>, apiKey: string, instructions: string,
  context: unknown, input: PhonePrediction, signal: AbortSignal, metric: PhoneModelMetric, started: number): Promise<PhoneDecision> {
  const responses = model.api === 'openai-responses';
  const schema = z.object({ decision: input.readOnly
    ? z.union([PhoneDecisionSchema.options[1], PhoneDecisionSchema.options[2]])
    : PhoneDecisionSchema }).strict();
  const tool = { name: TOOL_NAME, description: 'One authorized phone action, completion claim or request for user assistance.',
    parameters: z.toJSONSchema(schema) } as Tool;
  metric.transport = responses ? 'responses-stream' : 'chat-completions-stream';
  signal.throwIfAborted();
  metric.preparationMs = Math.round(performance.now() - started);
  // pi owns OAuth-specific request fields and completed-stream parsing.
  // Keep this ephemeral call out of transcript/telemetry context recording.
  const result = await completeSimple(model, {
    systemPrompt: instructions,
    messages: [{ role: 'user', timestamp: Date.now(), content: [
      { type: 'text', text: JSON.stringify(context) },
      { type: 'image', data: input.observation.frame.toString('base64'), mimeType: 'image/png' },
    ] }], tools: [tool],
  }, {
    apiKey, maxTokens: Math.min(3000, model.maxTokens ?? 3000), signal, maxRetries: 0, transport: 'sse', cacheRetention: 'none',
    onPayload(payload) {
      const body = payload as Record<string, unknown>;
      body.parallel_tool_calls = false;
      body.tool_choice = responses ? { type: 'function', name: TOOL_NAME } : { type: 'function', function: { name: TOOL_NAME } };
      if (responses) { body.store = false; body.stream = true; }
      metric.requestBytes = Buffer.byteLength(JSON.stringify(body));
    },
    onProviderStreamEvent(event) {
      metric.responseBytes = (metric.responseBytes ?? 0) + Buffer.byteLength(JSON.stringify(event));
      if (metric.responseBytes > 2 * 1024 * 1024) throw invalid();
    },
    onResponse(response) {
      metric.httpStatus = response.status;
      metric.firstByteMs = Math.round(performance.now() - started);
    },
  });
  signal.throwIfAborted();
  metric.finishReason = result.stopReason;
  metric.promptTokens = result.usage?.input;
  metric.completionTokens = result.usage?.output;
  metric.totalTokens = result.usage?.totalTokens;
  if (result.stopReason === 'length') throw new PhoneError('PHONE_MODEL_TRUNCATED', 'Phone model response was truncated; no action was dispatched');
  if (result.stopReason !== 'toolUse' || result.errorMessage) throw invalid();
  const calls = result.content.filter(item => item.type === 'toolCall');
  if (calls.length !== 1 || calls[0].name !== TOOL_NAME) throw invalid();
  let decision: PhoneDecision;
  try { decision = schema.parse(calls[0].arguments).decision; } catch { throw invalid(); }
  if (decision.kind === 'action' && decision.action.type === 'tapElement' && !input.enhancements?.semanticControls) throw invalid();
  return decision;
}
