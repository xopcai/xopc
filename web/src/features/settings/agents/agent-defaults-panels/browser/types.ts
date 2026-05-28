import type { MessageBundle } from '@/i18n/messages';

export type BrowserMessages = MessageBundle['agentSettings'];

export type DoctorState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; data: T }
  | { kind: 'error'; message: string };

export interface PlaywrightDoctor {
  installed: boolean;
  executablePath?: string | null;
  reason?: string;
}

export interface CloakDoctor {
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  platform: string;
  cacheDir: string;
  expectedSha256: string;
  downloadUrl: string;
  fallbackUrls: string[];
  customBinaryPath: boolean;
}

export interface CdpPingResult {
  reachable: boolean;
  browser?: string | null;
  protocolVersion?: string | null;
  webSocketDebuggerUrl?: string | null;
  error?: string;
  status?: number;
}

export interface CloudTestResult {
  reachable: boolean;
  error?: string;
  status?: number;
  projectCount?: number;
}

export interface LaunchedCdpInstance {
  port: number;
  wsEndpoint: string;
  pid: number;
  executablePath: string;
  userDataDir: string;
  startedAt: number;
}

export interface ExtensionProbe {
  running: boolean;
  connected: boolean;
  backend?: string;
}
