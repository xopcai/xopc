export interface ShareRecord {
  /** Unique identifier (UUIDv4) for management. */
  id: string;
  /** Cryptographically secure URL token (base64url, 32 bytes). */
  token: string;
  /** Resolved absolute path at creation time. */
  absolutePath: string;
  /** Workspace-relative POSIX path (for display). */
  workspaceRelativePath: string;
  /** Workspace root at creation time (for download-time re-validation). */
  workspaceRoot: string;
  /** File inode at creation time (TOCTOU protection). */
  inode: number;
  /** Whether this share targets a directory. */
  isDirectory: boolean;
  /** Original file name (basename). */
  fileName: string;
  /** File size in bytes (snapshot at creation). */
  fileSize: number;
  /** MIME type. */
  mimeType: string;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO expiration timestamp. */
  expiresAt: string;
  /** Maximum allowed views (null = unlimited). */
  maxViews: number | null;
  /** Current view count. */
  viewCount: number;
  /** Whether manually revoked. */
  revoked: boolean;
  /** Gateway token SHA-256 hash prefix (12 chars) of the creator. */
  createdByTokenHash: string;
  /** Optional human-readable description. */
  description?: string;
}

export interface CreateShareParams {
  /** Workspace-relative file path. */
  path: string;
  /** Time-to-live in milliseconds (default: 24h). */
  ttlMs?: number;
  /** Maximum view count (null = unlimited). */
  maxViews?: number | null;
  /** Optional description shown on the landing page. */
  description?: string;
  /** Session key to resolve workspace root. */
  sessionKey?: string;
  /** Agent id to resolve workspace root. */
  agentId?: string;
}

export interface ShareStoreData {
  version: 1;
  shares: ShareRecord[];
}

export type ShareReachability = 'public' | 'lan' | 'local-only';

export interface ResolvedShareUrl {
  shareUrl: string;
  lanUrl: string | null;
  reachability: ShareReachability;
  reachabilityHint: string | null;
}

export interface ShareConfig {
  enabled: boolean;
  defaultTtlMs: number;
  maxTtlMs: number;
  maxActiveShares: number;
  maxFileSize: number;
  inlinePreviewMimes: string[];
}

/** Default share configuration values. */
export const SHARE_CONFIG_DEFAULTS: ShareConfig = {
  enabled: true,
  defaultTtlMs: 86_400_000,
  maxTtlMs: 604_800_000,
  maxActiveShares: 100,
  maxFileSize: 104_857_600,
  inlinePreviewMimes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'text/html',
    'text/markdown',
    'text/plain',
    'application/json',
  ],
};
