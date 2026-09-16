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
  try {
    const { frame, ...metadata } = await broker.command(command);
    const content: EndpointToolContent[] = [{ type: 'json', value: metadata }];
    if (frame) {
      try {
        context.signal.throwIfAborted();
        content.push(await context.uploadFile({ name: frame.mimeType === 'image/jpeg' ? 'observation.jpg' : 'observation.png',
          mimeType: frame.mimeType, bytes: frame.bytes }));
      } catch (error) {
        await cancel();
        const diagnostic = computerDiagnostic(error);
        if (!metadata.receipt || !diagnostic) throw error;
        // Preserve an already-delivered input even when its verification frame cannot be uploaded.
        return { content: [{ type: 'json', value: { ...metadata, status: 'stopped', errorCode: diagnostic.errorCode, diagnostic } }] };
      } finally { frame.bytes.fill(0); }
    }
    return { content };
  } finally { context.signal.removeEventListener('abort', abort); }
}
