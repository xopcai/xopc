export type XopcShareKind = 'file' | 'directory' | 'site' | 'zip' | 'note' | 'session';
export type XopcShareReachability = 'public' | 'lan' | 'local-only';

export interface XopcShareItem {
  id: string;
  kind: XopcShareKind;
  fileName: string;
  shareUrl: string;
  lanUrl?: string | null;
  reachability: XopcShareReachability;
  reachabilityHint?: string | null;
  createdAt: string;
  expiresAt: string;
  downloadCount?: number;
  viewCount?: number;
  maxViews?: number | null;
  revoked: boolean;
  expired: boolean;
  description?: string | null;
  workspaceRelativePath?: string;
  sourceVersion?: number;
  snapshotRevision?: number;
  messageCount?: number;
  attachmentCount?: number;
}

export interface XopcShareListPayload { shares: XopcShareItem[]; }
export interface XopcShareListEnvelope { ok: boolean; payload: XopcShareListPayload; }

export interface XopcShareResult {
  id: string;
  kind: XopcShareKind;
  title: string;
  fileName?: string;
  description?: string;
  shareUrl: string;
  lanUrl?: string | null;
  reachability: XopcShareReachability;
  reachabilityHint?: string | null;
  expiresAt: string;
  maxViews?: number | null;
}

export interface XopcShareResultEnvelope { ok: boolean; payload: XopcShareResult; }

export interface XopcSessionSharePreview {
  transcriptId: string;
  cutoffSeq: number;
  metadataUpdatedAt: string;
  title: string;
  snapshotAt: string;
  messageCount: number;
  attachmentCandidates: XopcSessionShareAttachment[];
}

export interface XopcSessionShareAttachment {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface XopcSessionSharePreviewEnvelope { ok: boolean; payload: XopcSessionSharePreview; }

export interface XopcIncomingShare {
  title: string;
  content: string;
  chatPrompt: string;
  kind: 'url' | 'code' | 'todo' | 'long-text' | 'text';
  preview: string;
  sensitive: boolean;
}
