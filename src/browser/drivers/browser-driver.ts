import type {
  BrowserActionInput,
  BrowserControlResult,
  BrowserNavigateInput,
  BrowserObservation,
  BrowserObserveInput,
  BrowserTabsInput,
  BrowserTarget,
} from '@xopcai/browser-control-contract';

export type BrowserPrimitiveInput = Exclude<
  BrowserActionInput,
  BrowserNavigateInput | BrowserObserveInput | BrowserTabsInput | { action: 'sequence' } | { action: 'close' }
>;

export type BrowserInteractiveKey =
  | 'Enter'
  | 'Backspace'
  | 'Tab'
  | 'Escape'
  | 'Delete'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
  | 'Space'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight';

export type BrowserInteractiveInput =
  | { kind: 'pointer'; phase: 'down' | 'move' | 'up' | 'cancel' | 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: BrowserInteractiveKey }
  | { kind: 'navigate'; action: 'back' | 'forward' | 'reload' };

export interface ManagedBrowserFrame {
  bytes: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
}

export interface ManagedBrowserViewport {
  width: number;
  height: number;
  version: number;
}

export interface ManagedBrowserLiveHandle {
  readonly sessionId: string;
  getViewport(): ManagedBrowserViewport;
  getUrl(): string;
  getTitle(): Promise<string>;
  startScreencast(onFrame: (frame: ManagedBrowserFrame) => void): Promise<() => Promise<void>>;
  dispatchInput(input: BrowserInteractiveInput): Promise<void>;
  invalidateRefs(): void;
}

export interface BrowserDriver {
  readonly kind: 'playwright' | 'extension' | 'desktop';
  readonly abortClosesSession?: boolean;
  previewEndpoint?(sessionId: string): string | undefined;
  getLiveHandle?(sessionId: string): ManagedBrowserLiveHandle | undefined;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  createSession(sessionId: string): Promise<void>;
  closeSession(sessionId: string, target?: BrowserTarget): Promise<void>;
  navigate(sessionId: string, input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserControlResult>;
  observe(sessionId: string, input: BrowserObserveInput, signal?: AbortSignal): Promise<BrowserObservation>;
  perform(sessionId: string, input: BrowserPrimitiveInput, signal?: AbortSignal): Promise<BrowserControlResult>;
  tabs(sessionId: string, input: BrowserTabsInput, signal?: AbortSignal): Promise<BrowserControlResult>;
}
