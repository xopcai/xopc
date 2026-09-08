import type {
  BrowserControlResult,
  BrowserNavigateInput,
  BrowserObservation,
  BrowserObserveInput,
  BrowserTabsInput,
} from '@xopcai/browser-control-contract';

import type { ExtensionBrowserProvider } from '../providers/extension.js';
import type { BrowserDriver, BrowserPrimitiveInput } from './browser-driver.js';

export class ExtensionDriver implements BrowserDriver {
  readonly kind = 'extension' as const;

  constructor(
    private readonly provider: ExtensionBrowserProvider,
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

  navigate(sessionId: string, input: BrowserNavigateInput): Promise<BrowserControlResult> {
    return this.send({ ...input, sessionId });
  }

  async observe(sessionId: string, input: BrowserObserveInput): Promise<BrowserObservation> {
    const result = await this.send({ ...input, sessionId });
    if ('error' in result) throw new Error(result.error.message);
    const observation = result.receipt.observation;
    if (!observation) throw new Error('Extension returned no browser observation');
    return observation;
  }

  perform(sessionId: string, input: BrowserPrimitiveInput): Promise<BrowserControlResult> {
    return this.send({ ...input, sessionId });
  }

  tabs(sessionId: string, input: BrowserTabsInput): Promise<BrowserControlResult> {
    return this.send({ ...input, sessionId });
  }

  private async send(input: Parameters<ExtensionBrowserProvider['send']>[0]): Promise<BrowserControlResult> {
    return (await this.provider.send(input, this.timeoutMs, this.visualFallback)).result;
  }
}
