import type {
  BrowserControlResult,
  BrowserNavigateInput,
  BrowserObservation,
  BrowserObserveInput,
  BrowserTabsInput,
} from '@xopcai/browser-control-contract';

import type { BrowserDriver, BrowserPrimitiveInput } from './browser-driver.js';

type ExtensionProvider = {
  start(): Promise<void>;
  waitForConnection(timeoutMs?: number): Promise<void>;
  send(input: import('@xopcai/browser-control-contract').BrowserActionInput, timeoutMs?: number, visualFallback?: boolean, signal?: AbortSignal): Promise<import('@xopcai/browser-control-contract').BrowserWireResult>;
};

export class ExtensionDriver implements BrowserDriver {
  readonly kind = 'extension' as const;

  constructor(
    private readonly provider: ExtensionProvider,
    private readonly timeoutMs: number,
    private readonly visualFallback: boolean,
    private readonly release: () => Promise<void>,
  ) {}

  async connect(): Promise<void> {
    await this.provider.start();
    await this.provider.waitForConnection();
  }

  async disconnect(): Promise<void> {
    await this.release();
  }

  async createSession(_sessionId: string): Promise<void> {
    await this.connect();
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.send({ action: 'close', sessionId });
  }

  navigate(sessionId: string, input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    return this.send({ ...input, sessionId }, signal);
  }

  async observe(sessionId: string, input: BrowserObserveInput, signal?: AbortSignal): Promise<BrowserObservation> {
    const result = await this.send({ ...input, sessionId }, signal);
    if ('error' in result) throw new Error(result.error.message);
    const observation = result.receipt.observation;
    if (!observation) throw new Error('Extension returned no browser observation');
    return observation;
  }

  perform(sessionId: string, input: BrowserPrimitiveInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    return this.send({ ...input, sessionId }, signal);
  }

  tabs(sessionId: string, input: BrowserTabsInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    return this.send({ ...input, sessionId }, signal);
  }

  private async send(input: Parameters<ExtensionProvider['send']>[0], signal?: AbortSignal): Promise<BrowserControlResult> {
    return (await this.provider.send(input, this.timeoutMs, this.visualFallback, signal)).result;
  }
}
