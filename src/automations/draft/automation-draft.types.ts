import type { AutomationRun, AutomationRunEvent } from '../domain/types.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../domain/validation.js';

export interface CreateAutomationDraftRequest {
  prompt: string;
  agentId: string;
  language?: 'en' | 'zh';
}

export interface AutomationDraftResponse {
  draftId: string;
  automation: CreateAutomationInput;
  explanation: string;
  assumptions: string[];
  risks: string[];
  simulation: AutomationSimulation;
  repairAttempts: number;
}

export interface AutomationSimulation {
  triggerSummary: string;
  actionSummary: string;
  safetyNotes: string[];
  requiredConfirmations: string[];
  canRunNow: boolean;
  runNowBlockedReason?: string;
}

export interface CreateAutomationRepairDraftRequest {
  agentId: string;
  automation: CreateAutomationInput;
  run: AutomationRun;
  events: AutomationRunEvent[];
  language?: 'en' | 'zh';
}

export interface AutomationRepairDraftResponse {
  draftId: string;
  patch: UpdateAutomationInput;
  explanation: string;
  expectedEffect: string;
  risks: string[];
  requiresApproval: boolean;
  repairAttempts: number;
}
