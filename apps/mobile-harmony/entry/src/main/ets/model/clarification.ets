export interface XopcClarificationChoice { id: string; label: string; description?: string; }
export interface XopcClarificationApproval { operation: string; target?: string; impact?: string; argumentsPreview?: Object; }
export interface XopcClarification {
  id: string; conversationId: string; kind: string; status: string; question: string; version: number;
  interactionMode?: string; choiceDetails?: XopcClarificationChoice[]; recommendedChoiceId?: string;
  approval?: XopcClarificationApproval; expiresAt?: number;
}
export interface XopcClarificationAnswer { choiceId?: string; text?: string; }
export interface XopcClarificationCommand { action: string; response?: XopcClarificationAnswer; decision?: string; }
export interface XopcClarificationResponse extends XopcClarificationCommand { expectedVersion: number; idempotencyKey: string; }
