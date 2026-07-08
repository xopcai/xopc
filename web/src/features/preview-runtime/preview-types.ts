import type { ReactNode } from 'react';

import type { StoredLanguage } from '@/lib/storage';

export type PreviewContextKind = 'workspace' | 'attachment' | 'share';

export type PreviewFileType =
  | 'text'
  | 'markdown'
  | 'code'
  | 'html'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'spreadsheet'
  | 'pptx'
  | 'audio'
  | 'video'
  | 'archive'
  | 'unsupported';

export type PreviewReadMode = 'text' | 'binary' | 'url' | 'metadata';

export type PreviewCapability =
  | 'download'
  | 'fullscreen'
  | 'openWithSystemApp'
  | 'chooseApp'
  | 'revealInFolder'
  | 'copyPath'
  | 'toggleExtractedText'
  | 'search'
  | 'zoom'
  | 'rotate'
  | 'pageNavigation'
  | 'print'
  | 'edit';

export type PreviewSourceRef =
  | { kind: 'workspace'; path: string; sessionKey?: string; agentId?: string }
  | { kind: 'media-uri'; uri: string; sessionKey?: string | null }
  | { kind: 'share'; token: string }
  | { kind: 'inline' };

export type PreviewFileDescriptor = {
  id: string;
  context: PreviewContextKind;
  fileName: string;
  mimeType: string;
  size?: number;
  type: PreviewFileType;
  source: PreviewSourceRef;
};

export type PreviewLoadedSource = {
  descriptor: PreviewFileDescriptor;
  textContent: string | null;
  binaryBuffer: ArrayBuffer | null;
  rawUrl?: string;
  hostAbsolutePath?: string | null;
  mtimeMs?: number | null;
  loadError: string | null;
  loading: boolean;
};

export type PreviewActions = {
  onDownload: () => void | Promise<void>;
  canDownload: boolean;
  onOpenWithSystemApp?: () => void | Promise<void>;
  canOpenWithSystemApp?: boolean;
  onChooseOpenWithApp?: () => void | Promise<void>;
  canChooseOpenWithApp?: boolean;
};

export type PreviewWorkspaceEditing = {
  markdownEditMode: boolean;
  onSaveMarkdown?: (next: string) => void | Promise<void>;
  markdownWordWrap?: boolean;
  onToggleMarkdownWordWrap?: () => void;
  htmlCodeMode: boolean;
  onHtmlChange?: (next: string) => void;
  isDark?: boolean;
};

export type PreviewRuntimeRenderProps = PreviewLoadedSource & {
  language: StoredLanguage;
  resolvedTheme?: 'light' | 'dark';
  targetLine?: number | null;
  workspaceEditing?: PreviewWorkspaceEditing;
  showExtractedText?: boolean;
  extractedText?: string | null;
  extractedTextTruncated?: boolean;
  actions: PreviewActions;
  controls?: PreviewRuntimeControls;
};

export type PreviewRuntimeControls = {
  zoom: number;
  rotation: number;
  page: number;
  pageCount: number | null;
  searchQuery: string;
  setPageCount: (count: number | null) => void;
  setPage: (page: number) => void;
};

export type PreviewPlugin = {
  id: PreviewFileType;
  readMode: PreviewReadMode;
  maxBytes?: number;
  capabilities: PreviewCapability[];
  render: (props: PreviewRuntimeRenderProps) => ReactNode;
};
