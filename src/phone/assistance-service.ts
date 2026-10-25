import { randomUUID } from 'node:crypto';

import type { Config } from '../config/schema.js';
import type { SessionInput } from '../storage/sqlite/session-input-repository.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { phoneAssistance, type PhoneAssistance } from './assistance.js';
import { PhoneError } from './contracts.js';
import { getPhoneRuntime, phoneExecutionContext, type PhoneRuntime } from './runtime.js';

export async function completePhoneAssistanceFromUser(wait: PhoneAssistance, config: Config, runtime: PhoneRuntime = getPhoneRuntime()): Promise<void> {
  if (getSessionMetadata(wait.conversationId)?.agentId !== wait.checkpoint.report.agentId)
    throw new PhoneError('PHONE_ACCESS_CHANGED', 'The conversation Agent changed', 409);
  const context = phoneExecutionContext(config, wait.checkpoint.report.agentId);
  await runtime.restoreAssistance(wait.checkpoint, context, undefined, wait.id);
  await runtime.completeAssistanceForUser(wait.conversationId, context);
}

export async function preparePhoneContinuation(input: SessionInput, config: Config, runtime: PhoneRuntime = getPhoneRuntime()): Promise<boolean> {
  if (!input.clientMessageId.startsWith('phone-assistance:')) return true;
  const wait = phoneAssistance(input.conversationId);
  if (!wait || wait.queuedInputId !== input.id || wait.status !== 'queued') return false;
  if (getSessionMetadata(input.conversationId)?.agentId !== wait.checkpoint.report.agentId)
    throw new PhoneError('PHONE_ACCESS_CHANGED', 'The conversation Agent changed. Inspect the original task before continuing.', 409);
  const context = phoneExecutionContext(config, wait.checkpoint.report.agentId);
  const report = await runtime.restoreAssistance(wait.checkpoint, context, undefined, wait.id);
  if (report.controlOwner === 'human') throw new PhoneError('PHONE_PAUSED', 'The user is still operating the phone. Finish and continue again.', 409);
  if (report.status === 'needs_user' || report.status === 'paused') {
    await runtime.liveControl(input.conversationId, report.sessionId, context, `phone-resume:${wait.id}`,
      { op: 'handback', epoch: report.controlEpoch!, operationId: randomUUID() });
  }
  return true;
}
