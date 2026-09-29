export interface XopcUnderstandingProfile {
  callName: string;
  role: string;
  pronouns: string;
  timezone: string;
  locale: string;
}

export interface XopcUnderstandingCounts {
  total: number;
  explicit: number;
  learned: number;
  review: number;
  workMemory: number;
}

export interface XopcUnderstandingSource {
  id: string;
  kind: string;
  label?: string;
  category?: string;
  observedAt: number;
}

export interface XopcUnderstandingScope { type: string; id?: string; }

export interface XopcUnderstandingItem {
  id: string;
  predicate: string;
  statement: string;
  kind: string;
  status: string;
  authority: string;
  usable: boolean;
  confidence: number;
  volatility: string;
  layer: string;
  independentSourceCount: number;
  observedAt: number;
  recordedAt: number;
  validTo?: number;
  scope: XopcUnderstandingScope;
  sources: XopcUnderstandingSource[];
}

export interface XopcUnderstandingFocus { id: string; title: string; desiredOutcome?: string; validTo: number; }
export interface XopcUnderstandingRule { id: string; statement: string; category: string; }
export interface XopcUserGoal {
  id: string;
  title: string;
  desiredOutcome: string;
  status: string;
  targetAt?: number;
  updatedAt: number;
  isPrimary: boolean;
}

export interface XopcUnderstandingSummary {
  profile: XopcUnderstandingProfile;
  suggestedCallName: string;
  counts: XopcUnderstandingCounts;
  primaryFocus?: XopcUnderstandingFocus;
  goals?: XopcUserGoal[];
  recent: XopcUnderstandingItem[];
  rules: XopcUnderstandingRule[];
}

export interface XopcUnderstandingPage { items: XopcUnderstandingItem[]; nextCursor?: string; }
export interface XopcUnderstandingItemResponse { assertion: XopcUnderstandingItem; }
