export type XopcGeneratedMediaKind = 'music' | 'video';

export interface XopcGeneratedMediaItem {
  id: string;
  transcriptId?: string;
  title?: string;
  summary?: string;
  prompt?: string;
  lyrics?: string;
  state?: string;
  durationMs?: number;
  duration?: number;
  resolution?: string;
  ratio?: string;
  revision?: number;
  estimatedCostFen?: number;
  estimatedCreditMicro?: number;
  versionNumber?: number;
  error?: string;
  modelRef?: string;
  createdAt: number;
  draftCreatedAt?: number;
}

export interface XopcGeneratedMediaJobs {
  jobs: XopcGeneratedMediaItem[];
  draft?: XopcGeneratedMediaItem;
  transcriptId?: string;
  configured?: boolean;
  modelRef?: string;
}

export interface XopcGeneratedMediaCard {
  kind: XopcGeneratedMediaKind;
  item: XopcGeneratedMediaItem;
  draft: boolean;
  canConfirm: boolean;
}
