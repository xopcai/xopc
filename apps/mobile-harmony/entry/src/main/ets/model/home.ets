export interface XopcHomeAction {
  type: string; label: string; href?: string; approvalId?: string;
  decision?: string; subjectKind?: string; runId?: string;
}
export interface XopcHomeItem {
  id: string; kind: string; title: string; summary: string; statusLabel?: string; recommendation?: string;
  updatedAt?: number; reviewDetail?: string;
  openAction?: XopcHomeAction; primaryAction?: XopcHomeAction; secondaryActions: XopcHomeAction[];
}
export interface XopcHomeDecision { detail?: string; response?: XopcHomeDecisionResponse; }
export interface XopcHomeDecisionResponse { approvalId?: string; }
export interface XopcHomeResponse { needsUser: XopcHomeItem[]; background: XopcHomeItem[]; backgroundCount: number; decisions?: XopcHomeDecision[]; }
export interface XopcMobileRoute { page: string; itemId: string; }
export interface XopcHomeCommand { kind: string; runId?: string; approvalId?: string; decision?: string; }
