import type { Browser, BrowserContext } from 'playwright-core';

export interface CloudBrowserProvider {
  readonly name: string;
  connect(): Promise<{ browser: Browser; context: BrowserContext }>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export interface CloudBrowserProviderConfig {
  type: 'browserbase' | 'browser-use';
  apiKey?: string;
  projectId?: string;
  region?: string;
}
