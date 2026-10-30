import type { ComputerCommand } from '@xopcai/computer-control-contract';
import type { EndpointToolExecutionContext, EndpointToolExecutionResult } from '@xopcai/endpoint-tools-client';
import type { EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

import type { ComputerBroker } from '../../src/computer/broker.js';
import { computerDiagnostic } from '../../src/computer/errors.js';
import { createLogger } from '../../src/utils/logger.js';

const log = createLogger('ComputerTransport');

export async function executeComputerCommand(
  broker: Pick<ComputerBroker, 'command' | 'cancel'>,
  command: ComputerCommand,
  context: EndpointToolExecutionContext,
): Promise<EndpointToolExecutionResult> {
  const cancel = () => broker.cancel(command).catch(() => {
    log.warn({ invocationId: context.invocationId, phase: 'cleanup' }, 'Computer driver cleanup failed after session revocation');
  });
  const abort = () => { void cancel(); };
  context.signal.throwIfAborted();
  context.signal.addEventListener('abort', abort, { once: true });
  const startedAt = performance.now();
  try {
    const brokerStarted = performance.now();
    let result: Awaited<ReturnType<ComputerBroker['command']>>;
    try { result = await broker.command(command); }
    catch (error) {
      context.signal.throwIfAborted();
      const diagnostic = computerDiagnostic(error);
      if (!diagnostic || command.op !== 'observe') throw error;
      // Read stopped-session metadata only; preserve typed capture failures across endpoint transport.
      const status = await broker.command({ op: 'status', sessionId: command.sessionId, owner: command.owner });
      result = { ...status, errorCode: diagnostic.errorCode, diagnostic };
    }
    const { frame, ...metadata } = result;
    const transport = { brokerWallMs: performance.now() - brokerStarted, frameUploadMs: null as number | null, commandWallMs: 0 };
    const payload = { ...metadata, transportTiming: transport };
    const content: EndpointToolContent[] = [{ type: 'json', value: payload }];
    if (frame) {
      const uploadStarted = performance.now();
      try {
        context.signal.throwIfAborted();
        content.push(await context.uploadFile({ name: frame.mimeType === 'image/jpeg' ? 'observation.jpg' : 'observation.png',
          mimeType: frame.mimeType, bytes: frame.bytes }));
      } catch (error) {
        await cancel();
        const diagnostic = computerDiagnostic(error);
        if (!metadata.receipt || !diagnostic) throw error;
        // Preserve an already-delivered input even when its verification frame cannot be uploaded.
        return { content: [{ type: 'json', value: { ...payload, status: 'stopped', errorCode: diagnostic.errorCode, diagnostic } }] };
      } finally {
        transport.frameUploadMs = performance.now() - uploadStarted;
        transport.commandWallMs = performance.now() - startedAt;
        frame.bytes.fill(0);
      }
    }
    transport.commandWallMs = performance.now() - startedAt;
    return { content };
  } finally { context.signal.removeEventListener('abort', abort); }
}
