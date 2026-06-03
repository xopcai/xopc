export type SiteSourceKind = 'static' | 'proxy';

export interface SiteStaticSource {
  kind: 'static';
  /** Absolute filesystem root of the static site directory. */
  rootDir: string;
  /** Workspace root captured at creation for re-validation. */
  workspaceRoot: string;
  /** Workspace-relative POSIX path for display. */
  workspaceRelativePath: string;
  /** Send index.html (status 200) for unmatched paths under root (SPA). */
  spaFallback: boolean;
  /** Whether HTML/CSS absolute-path rewriting is applied. */
  rewriteMode: 'none' | 'html-only' | 'html-css';
  /** Regex string matched against URL path; matches get an immutable cache. */
  immutableAssetsRegex?: string;
}

export interface SiteProxySource {
  kind: 'proxy';
  /** Upstream base URL (e.g. http://127.0.0.1:3000). */
  upstreamUrl: string;
  /** Forward Set-Cookie path attribute (subpath mode only). */
  rewriteSetCookiePath: boolean;
  /** Whether to handle WebSocket upgrades. */
  forwardWebSocket: boolean;
  /** Per-request forwarded headers strategy. */
  forwardedHeaders: 'minimal' | 'full';
}

export type SiteSource = SiteStaticSource | SiteProxySource;

export interface SiteShareRecord {
  id: string;
  /** Token used both as the URL subdomain label (subdomain mode) and as `/site/:token/` subpath fallback. */
  token: string;
  /** Optional creator-chosen subdomain (must be unique, only [a-z0-9-]). */
  subdomain: string | null;
  source: SiteSource;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  description?: string;
  createdByTokenHash: string;
  requestCount: number;
  uniqueClientCount: number;
  /** Hard cap on total requests served (null = unlimited). */
  maxRequests: number | null;
  /** Cached client IPs that have counted toward uniqueClientCount (last 200). */
  recentClientIps?: string[];
}

export interface SiteShareStoreData {
  version: 1;
  shares: SiteShareRecord[];
}

export interface CreateSiteShareParams {
  /** 'static' uses workspace path; 'proxy' uses upstreamUrl. */
  kind: SiteSourceKind;
  /** Static: workspace-relative path of build output. */
  path?: string;
  /** Proxy: full upstream URL (must be loopback or whitelisted). */
  upstreamUrl?: string;
  /** Default 6h. */
  ttlMs?: number;
  /** Optional friendly description. */
  description?: string;
  /** Optional preferred subdomain (will fall back to token if taken). */
  subdomain?: string;
  /** Optional max request count. */
  maxRequests?: number | null;
  /** Static: SPA fallback (default true for static). */
  spaFallback?: boolean;
  /** Static: rewrite mode (default 'none'). */
  rewriteMode?: 'none' | 'html-only' | 'html-css';
  /** Proxy: forward WS (default true if enabled in config). */
  forwardWebSocket?: boolean;
  sessionKey?: string;
  agentId?: string;
}

export interface SiteShareConfig {
  enabled: boolean;
  publicHostSuffix: string;
  defaultTtlMs: number;
  maxTtlMs: number;
  maxActiveSites: number;
  static: {
    enabled: boolean;
    maxRootDirSize: number;
    maxFileCount: number;
    rewriteEnabledByDefault: boolean;
  };
  proxy: {
    enabled: boolean;
    allowedUpstreamHosts: string[];
    allowedUpstreamPorts: number[];
    forwardWebSocket: boolean;
    bodySizeLimit: number;
    requestTimeoutMs: number;
    wsIdleTimeoutMs: number;
    rewriteSetCookiePath: boolean;
  };
}

export const SITE_SHARE_CONFIG_DEFAULTS: SiteShareConfig = {
  enabled: true,
  publicHostSuffix: 'share.xopc.ai',
  defaultTtlMs: 21_600_000,
  maxTtlMs: 604_800_000,
  maxActiveSites: 5,
  static: {
    enabled: true,
    maxRootDirSize: 524_288_000,
    maxFileCount: 10_000,
    rewriteEnabledByDefault: false,
  },
  proxy: {
    enabled: true,
    allowedUpstreamHosts: ['127.0.0.1', 'localhost', '::1'],
    allowedUpstreamPorts: [3000, 3001, 4321, 5173, 8000, 8080, 8888, 9000],
    forwardWebSocket: true,
    bodySizeLimit: 52_428_800,
    requestTimeoutMs: 30_000,
    wsIdleTimeoutMs: 300_000,
    rewriteSetCookiePath: true,
  },
};
