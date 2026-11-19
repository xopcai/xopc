import { XopcArtifact, XopcProductReference } from './chat';

export interface XopcPersonalWorkPresentation { status: string; }
export interface XopcPersonalWorkPrompt { id: string; }
export interface XopcPersonalWorkAttention { kind: string; }
export interface XopcPersonalWorkItem {
  id: string;
  title: string;
  phase: string;
  operationalState?: string;
  presentation?: XopcPersonalWorkPresentation;
  attention?: XopcPersonalWorkAttention;
  prompt?: XopcPersonalWorkPrompt;
  updatedAt: number;
}

export interface XopcPersonalWorkPage {
  current: XopcPersonalWorkItem[];
  items: XopcPersonalWorkItem[];
  total: number;
}

export interface XopcPersonalWorkGroup { id: string; items: XopcPersonalWorkItem[]; }
export interface XopcPersonalDeliveryTask { id: string; title: string; conversationId?: string; }
export interface XopcPersonalDelivery {
  id: string;
  createdAt: number;
  task?: XopcPersonalDeliveryTask;
  artifact?: XopcArtifact;
  reference?: XopcProductReference;
}
export interface XopcPersonalDeliveriesPage { items: XopcPersonalDelivery[]; nextOffset: number | null; }

export function personalWorkStatus(item: XopcPersonalWorkItem): string {
  return item.presentation?.status ?? item.operationalState ?? item.phase;
}

export function personalWorkNeedsAttention(item: XopcPersonalWorkItem): boolean {
  return !!item.attention || item.presentation?.status === 'needsUser' || item.presentation?.status === 'review';
}

export function personalPromptNeedsAttention(promptId: string, attention: XopcPersonalWorkItem[]): boolean {
  return !!promptId && !attention.some((item: XopcPersonalWorkItem): boolean => item.prompt?.id === promptId);
}
