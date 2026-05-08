import type { Browser, BrowserContext } from 'playwright-core';

/**
 * Cloud browser provider abstraction — aligned with hermes-agent's multi-backend architecture.
 *
 * Each provider is responsible for creating a Playwright-compatible Browser/Context
 * that the BrowserManager can use interchangeably with local Chromium.
 */
export interface CloudBrowserProvider {
  /** Human-readable provider name for logging. */
  readonly name: string;

  /**
   * Connect to the cloud browser and return a Playwright BrowserContext.
   * The provider owns the underlying Browser instance lifecycle.
   */
  connect(): Promise<{ browser: Browser; context: BrowserContext }>;

  /**
   * Gracefully disconnect from the cloud browser.
   * Called during shutdown or session cleanup.
   */
  disconnect(): Promise<void>;

  /** Whether the provider is currently connected. */
  isConnected(): boolean;
}

/** Configuration needed to instantiate a cloud browser provider. */
export interface CloudBrowserProviderConfig {
  /** Provider type identifier. */
  type: 'browserbase' | 'browser-use';
  /** API key for the cloud provider. */
  apiKey: string;
  /** Optional project/session identifier. */
  projectId?: string;
  /** Optional region preference. */
  region?: string;
}

/** Configuration for direct CDP WebSocket connection (bypasses cloud provider). */
export interface CdpConnectionConfig {
  /** WebSocket endpoint URL (e.g. ws://localhost:9222/devtools/browser/...). */
  wsEndpoint: string;
}

/** Union of all backend connection modes. */
export type BrowserBackend =
  | { mode: 'local'; headless: boolean }
  | { mode: 'cdp'; config: CdpConnectionConfig }
  | { mode: 'cloud'; config: CloudBrowserProviderConfig };
