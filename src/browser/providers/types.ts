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
  /** API key for the cloud provider. Falls back to provider-specific environment variables. */
  apiKey?: string;
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

/** Configuration for the xopc Chrome Extension bridge backend. */
export interface ExtensionConnectionConfig {
  /** WebSocket server port. Default: 19820. */
  port?: number;
  /** Host to bind. Default: 127.0.0.1. */
  host?: string;
  /** Timeout waiting for extension to connect (ms). Default: 30000. */
  connectionTimeout?: number;
  /** Default command timeout (ms). Default: 30000. */
  commandTimeout?: number;
}

import type { BrowserInstallProgress } from '../install-progress.js';

/** Configuration for CloakBrowser — anti-fingerprint Chromium with stealth capabilities. */
export interface CloakBrowserConfig {
  /** Directory for cached CloakBrowser binaries. Default: ~/.xopc/bin/cloakbrowser. */
  cacheDir?: string;
  /** Override the CloakBrowser binary path (skip auto-download). */
  binaryPath?: string;
  /** Run headless. Default: false. */
  headless?: boolean;
  /** Fixed CDP debugging port. Default: auto-pick free port, or 9222 if keepOpen. */
  cdpPort?: number;
  /** Keep browser process alive between tasks. Default: true. */
  keepOpen?: boolean;
  /** Reuse an already-running CloakBrowser instance on the same port. Default: false. */
  reuseExisting?: boolean;
  /** Create a temporary profile directory, cleaned up on close. Default: false. */
  temporaryProfile?: boolean;
  /** Persistent user data directory (overrides temporaryProfile). */
  userDataDir?: string;
  /** Extra Chromium launch args (override defaults with same --key= prefix). */
  extraArgs?: string[];
  /** Timezone to emulate (e.g. "America/New_York"). */
  timezone?: string;
  /** Locale to emulate (e.g. "en-US"). */
  locale?: string;
  /** Public IP for WebRTC leak prevention. */
  webrtcIp?: string;
  /** Platform to emulate in fingerprint (e.g. "windows", "macos"). */
  fingerprintPlatform?: string;
  /** Enable humanized input (mouse/keyboard/scroll). Default: true. */
  humanize?: boolean;
  /** Humanize behavior preset. Default: 'careful'. */
  humanPreset?: 'default' | 'careful';
  /** Optional install/download progress callback (gateway SSE, CLI). */
  onProgress?: (progress: BrowserInstallProgress) => void | Promise<void>;
  /** Abort long-running install/download (client disconnect). */
  signal?: AbortSignal;
  /** When true, wait for CDP then return without connecting Playwright (settings "open browser"). */
  skipPlaywrightConnect?: boolean;
}

/** Union of all backend connection modes. */
export type BrowserBackend =
  | { mode: 'local'; headless: boolean }
  | { mode: 'cdp'; config: CdpConnectionConfig }
  | { mode: 'cloud'; config: CloudBrowserProviderConfig }
  | { mode: 'extension'; config?: ExtensionConnectionConfig }
  | { mode: 'cloakbrowser'; config?: CloakBrowserConfig };
