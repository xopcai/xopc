import type {
  BrowserActionInput,
  BrowserControlResult,
  BrowserNavigateInput,
  BrowserObservation,
  BrowserObserveInput,
  BrowserTabsInput,
} from '@xopcai/browser-control-contract';

export type BrowserPrimitiveInput = Exclude<
  BrowserActionInput,
  BrowserNavigateInput | BrowserObserveInput | BrowserTabsInput | { action: 'sequence' } | { action: 'close' }
>;

export interface BrowserDriver {
  readonly kind: 'playwright' | 'extension';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  createSession(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  navigate(sessionId: string, input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserControlResult>;
  observe(sessionId: string, input: BrowserObserveInput, signal?: AbortSignal): Promise<BrowserObservation>;
  perform(sessionId: string, input: BrowserPrimitiveInput, signal?: AbortSignal): Promise<BrowserControlResult>;
  tabs(sessionId: string, input: BrowserTabsInput, signal?: AbortSignal): Promise<BrowserControlResult>;
}
