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
