import { ComputerCommandSchema, REMOTE_COMPUTER_CONTROL_TOOL, type ComputerCommand } from '@xopcai/computer-control-contract';
import { durableEndpointResultSchema, type DesktopOperationIntent, type EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

import type { ComputerBroker } from '../../src/computer/broker.js';
import type { DesktopExecutionWorker } from './operation-supervisor.js';

type Broker = Pick<ComputerBroker, 'command' | 'dispose'>;
type Frame = NonNullable<Awaited<ReturnType<Broker['command']>>['frame']>;

/** Remote-only, one-grant Computer coordinator. Construction never starts a driver or performs input. */
export class DesktopComputerSession {
  private broker?: Broker;
  private owner?: string;
  private active?: DesktopOperationIntent;
  private closed = false;
  private stopping?: Promise<{ confirmed: boolean }>;
  constructor(private readonly options: {
    current(): boolean;
    /** Must use the existing ComputerBroker with deferred approval disabled and independent native consent. */
    createBroker(): Broker;
    /** Only invocation-bound upload grants may implement this hook. Paths and bytes never enter durable metadata. */
    uploadFrame(frame: Frame, intent: DesktopOperationIntent, signal: AbortSignal): Promise<Extract<EndpointToolContent, { type: 'file' }>>;
  }) {}

  worker(intent: DesktopOperationIntent): DesktopExecutionWorker {
    if (intent.tool !== REMOTE_COMPUTER_CONTROL_TOOL || intent.workspaceId || this.closed) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
    const operation = structuredClone(intent);
    let started = false, cancelled = false;
    return {
      run: async (args, signal) => {
        if (started) throw new Error('DESKTOP_COMPUTER_ALREADY_STARTED');
        started = true;
        signal.throwIfAborted();
        if (cancelled || this.closed || !this.options.current()) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
        if (this.active) throw new Error('DESKTOP_COMPUTER_BUSY');
        const command = ComputerCommandSchema.parse(args);
        if (this.owner && command.owner !== this.owner) throw new Error('DESKTOP_COMPUTER_OWNER_MISMATCH');
        this.owner ??= command.owner;
        this.active = operation;
        // DesktopOperationSupervisor commits the intent before calling run. Keep the driver factory here.
        const abort = () => { void this.stop(); };
        signal.addEventListener('abort', abort, { once: true });
        let frame: Frame | undefined;
        try {
          this.broker ??= this.options.createBroker();
          signal.throwIfAborted();
          if (this.closed || !this.options.current()) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
          const result = await this.broker.command(command as ComputerCommand);
          frame = result.frame;
          signal.throwIfAborted();
          if (this.closed || !this.options.current()) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
          if (!['ready', 'stopped'].includes(result.status)
            || result.receipt && !['completed', 'notStarted'].includes(result.receipt.dispatch)) {
            throw new Error('DESKTOP_COMPUTER_OUTCOME_UNKNOWN');
          }
          const { frame: _frame, ...metadata } = result;
          const content: EndpointToolContent[] = [{ type: 'json', value: JSON.parse(JSON.stringify(metadata)) }];
          if (frame) content.push(await this.options.uploadFrame(frame, operation, signal));
          signal.throwIfAborted();
          if (this.closed || !this.options.current()) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
          return { status: 'succeeded' as const, result: durableEndpointResultSchema.parse({ content }) };
        } catch (error) {
          // No completed receipt can escape while broker preparation or native input may still be pending.
          await this.stop();
          throw error;
        } finally {
          frame?.bytes.fill(0);
          signal.removeEventListener('abort', abort);
          if (this.active === operation) this.active = undefined;
        }
      },
      stop: async () => { cancelled = true; return this.stop(); },
    };
  }

  stop(): Promise<{ confirmed: boolean }> {
    this.closed = true;
    if (!this.stopping) {
      this.stopping = Promise.resolve().then(async () => {
        await this.broker?.dispose();
        return { confirmed: true };
      }).catch(() => {
        this.stopping = undefined;
        return { confirmed: false };
      });
    }
    return this.stopping;
  }
}
