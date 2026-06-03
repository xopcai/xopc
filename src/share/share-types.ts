export type ShareKind = 'file' | 'directory';

export interface ShareDirectoryMeta {
  /** 'browse' shows a file tree; 'zip-only' hides structure and only offers ZIP. */
  mode: 'browse' | 'zip-only';
  /** Snapshot entry count at creation time (display + sanity guard). */
  entryCount: number;
  /** Whether the symlink filter at scan time was permissive. */
  followSymlinks: boolean;
  /** Maximum traversal depth (defense against recursive symlinks). */
  maxDepth: number;
}

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
  /** File or directory inode at creation time (TOCTOU protection). */
  inode: number;
  /** Discriminator for downstream branching ('file' | 'directory'). */
  kind: ShareKind;
  /** Original file/folder name (basename). */
  fileName: string;
  /**
   * For files: file size in bytes (snapshot at creation).
   * For directories: sum of file sizes at scan time (display only).
   */
  fileSize: number;
  /** MIME type (directories: 'application/x-directory'). */
  mimeType: string;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO expiration timestamp. */
  expiresAt: string;
  /** Maximum allowed downloads (null = unlimited). Counts file/zip/preview events. */
  maxViews: number | null;
  /** Download counter (file-bytes / zip-bytes / preview events). Landing-page renders never count. */
  downloadCount: number;
  /** Whether manually revoked. */
  revoked: boolean;
  /** Gateway token SHA-256 hash prefix (12 chars) of the creator. */
  createdByTokenHash: string;
  /** Optional human-readable description. */
  description?: string;
  /** Directory-only extra fields. */
  directory?: ShareDirectoryMeta;
}

export interface CreateShareParams {
  /** Workspace-relative file path. */
  path: string;
  /** Time-to-live in milliseconds (default: 24h). */
  ttlMs?: number;
  /** Maximum view/download count (null = unlimited). */
  maxViews?: number | null;
  /** Optional description shown on the landing page. */
  description?: string;
  /** Session key to resolve workspace root. */
  sessionKey?: string;
  /** Agent id to resolve workspace root. */
  agentId?: string;
  /** Force directory share semantics (overrides auto-detection). */
  kind?: ShareKind;
  /** Directory: browse vs zip-only. Defaults to 'browse'. */
  directoryMode?: 'browse' | 'zip-only';
  /** Directory: cap on entry count at scan time. */
  maxFileCount?: number;
  /** Directory: cap on total folder size in bytes. */
  maxFolderSize?: number;
  /** Directory: whether to follow symlinks (subject to workspace boundary). */
  followSymlinks?: boolean;
  /** Directory: walk depth cap (default 20). */
  maxDepth?: number;
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

export interface ShareDirectoryConfig {
  enabled: boolean;
  maxFolderSize: number;
  maxFileCount: number;
  maxDepth: number;
  listingCacheMs: number;
  zipConcurrency: number;
}

export interface ShareConfig {
  enabled: boolean;
  defaultTtlMs: number;
  maxTtlMs: number;
  maxActiveShares: number;
  maxFileSize: number;
  inlinePreviewMimes: string[];
  directory: ShareDirectoryConfig;
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
  directory: {
    enabled: true,
    maxFolderSize: 1_073_741_824, // 1 GB
    maxFileCount: 1000,
    maxDepth: 20,
    listingCacheMs: 60_000,
    zipConcurrency: 1,
  },
};
