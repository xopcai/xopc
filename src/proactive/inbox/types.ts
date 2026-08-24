export type InboxStatus = 'unread' | 'read' | 'snoozed' | 'resolved';

export interface InboxItem {
  id: string;
  insightId: string;
  status: InboxStatus;
  snoozedUntil?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  insight: {
    scenarioKey: string; title: string; summary: string; whyNow: string; impact: string;
    recommendation: string; workDone: string;
    decision?: { question: string; options: Array<{ id: string; label: string; consequence: string }> };
    proposedAction?: {
      id: 'create_project_task'; risk: 'low'; rationale: string;
      input: { title: string; objective: string };
    };
    disposition: 'show_in_work' | 'request_approval' | 'auto_execute';
    dispositionReason: string;
    actionStatus?: 'not_authorized' | 'approval_required' | 'pending' | 'executing' | 'completed' | 'rejected' | 'failed';
    actionResult?: Record<string, unknown>;
    actionError?: string;
    urgency: 'low' | 'medium' | 'high' | 'critical'; confidence: number;
    valueScore: number; evidenceIds: string[];
  };
}

export interface InboxDelivery {
  inboxItem: InboxItem;
  deliveryId: string;
}

export interface InboxDeliveryAdapter {
  deliver(delivery: InboxDelivery): Promise<void>;
}
