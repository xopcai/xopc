import Ajv2020 from 'ajv/dist/2020.js';
import type { BrowserControlResult } from '@xopcai/browser-control-contract';
import { REMOTE_BROWSER_CONTROL_TOOL, REMOTE_BROWSER_FRAME_MAX_BYTES, REMOTE_BROWSER_INPUT_SCHEMA, type RemoteBrowserCommand } from '@xopcai/browser-control-contract/remote';
import { durableEndpointResultSchema, type DesktopOperationIntent, type EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

import type { DesktopExecutionWorker } from './operation-supervisor.js';

type Frame = { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' };
export interface DesktopBrowserBroker {
  execute(command: RemoteBrowserCommand, signal: AbortSignal): Promise<{
    result: BrowserControlResult;
    dispatch: 'completed' | 'notStarted' | 'unknown';
    frame?: Frame;
  }>;
  dispose(): Promise<{ confirmed: boolean }>;
}
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(REMOTE_BROWSER_INPUT_SCHEMA);

/** Remote-only coordinator. Its inert factory and browser work run only after the supervisor's durable journal barrier. */
export class DesktopBrowserSession {
  private broker?: DesktopBrowserBroker;
  private owner?: string;
  private sessionId?: string;
  private active?: DesktopOperationIntent;
  private closed = false;
  private stopping?: Promise<{ confirmed: boolean }>;
  constructor(private readonly options: {
    current(): boolean;
    createBroker(): DesktopBrowserBroker;
    prepareOperation?(intent: DesktopOperationIntent, signal: AbortSignal): Promise<void>;
    uploadFrame(frame: Frame, intent: DesktopOperationIntent, signal: AbortSignal): Promise<Extract<EndpointToolContent, { type: 'file' }>>;
  }) {}

  worker(input: DesktopOperationIntent): DesktopExecutionWorker {
    if (this.closed || input.tool !== REMOTE_BROWSER_CONTROL_TOOL || input.workspaceId) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
    const intent = structuredClone(input);
    let started = false, cancelled = false;
    return {
      run: async (raw, signal) => {
        if (started) throw new Error('DESKTOP_BROWSER_ALREADY_STARTED');
        started = true; signal.throwIfAborted();
        if (cancelled || this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
        if (this.active) throw new Error('DESKTOP_BROWSER_BUSY');
        const json = JSON.stringify(raw);
        if (Buffer.byteLength(json) > 16384) throw new Error('DESKTOP_BROWSER_INPUT_LIMIT');
        const value = JSON.parse(json);
        if (!validate(value)) throw new Error('DESKTOP_BROWSER_INPUT_INVALID');
        const command = value as RemoteBrowserCommand;
        if (this.owner && command.owner !== this.owner || this.sessionId && command.sessionId !== this.sessionId) throw new Error('DESKTOP_BROWSER_OWNER_MISMATCH');
        this.owner ??= command.owner; this.sessionId ??= command.sessionId;
        this.active = intent;
        const abort = () => { void this.stop(); };
        signal.addEventListener('abort', abort, { once: true });
        let frame: Frame | undefined;
        try {
          this.broker ??= this.options.createBroker();
          await this.options.prepareOperation?.(intent, signal);
          signal.throwIfAborted();
          if (this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
          const reply = await this.broker.execute(command, signal); frame = reply.frame;
          signal.throwIfAborted();
          if (this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
          if (!['completed', 'notStarted'].includes(reply.dispatch)) throw new Error('DESKTOP_BROWSER_OUTCOME_UNKNOWN');
          const observation = 'error' in reply.result ? reply.result.error.observation : reply.result.receipt.observation;
          if (observation && (observation.sessionId !== command.sessionId || observation.visual)
            || frame && (!observation || command.input.action === 'close' || !['image/png', 'image/jpeg'].includes(frame.mimeType)
              || !frame.bytes.byteLength || frame.bytes.byteLength > REMOTE_BROWSER_FRAME_MAX_BYTES)) throw new Error('DESKTOP_BROWSER_RESULT_MISMATCH');
          if (Buffer.byteLength(JSON.stringify(reply.result)) > 49152) throw new Error('DESKTOP_BROWSER_RESULT_LIMIT');
          const content: EndpointToolContent[] = [{ type: 'json', value: JSON.parse(JSON.stringify({ version: 1, result: reply.result, dispatch: reply.dispatch })) }];
          if (frame) content.push(await this.options.uploadFrame(frame, intent, signal));
          signal.throwIfAborted();
          if (this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
          if (command.input.action === 'close') {
            if (!(await this.broker.dispose()).confirmed) throw new Error('DESKTOP_BROWSER_STOP_UNCONFIRMED');
            this.broker = undefined; this.sessionId = undefined;
          }
          return { status: 'succeeded' as const, result: durableEndpointResultSchema.parse({ content }) };
        } catch (error) {
          await this.stop(); throw error;
        } finally {
          frame?.bytes.fill(0); signal.removeEventListener('abort', abort);
          if (this.active === intent) this.active = undefined;
        }
      },
      stop: async () => { cancelled = true; return this.stop(); },
    };
  }
  stop(): Promise<{ confirmed: boolean }> {
    this.closed = true;
    if (!this.stopping) this.stopping = Promise.resolve().then(async () => {
      const result = await this.broker?.dispose() ?? { confirmed: true };
      if (!result.confirmed) this.stopping = undefined;
      return result;
    }).catch(() => { this.stopping = undefined; return { confirmed: false }; });
    return this.stopping;
  }
}
