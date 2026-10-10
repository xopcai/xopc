import type { BrowserExpectation, BrowserRiskLevel } from '@xopcai/browser-control-contract';
import type { BrowserSemanticTarget } from '@xopcai/browser-control-contract';
export type { BrowserSemanticTarget } from '@xopcai/browser-control-contract';

export type BrowserAutomationStatus = 'enabled' | 'disabled';
export type BrowserAutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BrowserAutomationInputDefinition {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  choices?: Array<string | number | boolean>;
}

export interface BrowserAutomationAssertion {
  target?: BrowserSemanticTarget;
  field: 'text' | 'value' | 'url' | 'title' | 'checked';
  equals?: string | boolean;
  includes?: string;
}

export type BrowserAutomationStep =
  | { action: 'navigate'; url: string; expect?: BrowserExpectation }
  | { action: 'click'; target: BrowserSemanticTarget; expect?: BrowserExpectation }
  | { action: 'fill'; target: BrowserSemanticTarget; value: string; submit?: boolean; expect?: BrowserExpectation }
  | { action: 'select'; target: BrowserSemanticTarget; value: string; expect?: BrowserExpectation }
  | { action: 'check'; target: BrowserSemanticTarget; checked: boolean }
  | { action: 'press'; target?: BrowserSemanticTarget; key: string; expect?: BrowserExpectation }
  | { action: 'scroll'; target?: BrowserSemanticTarget; deltaY: number; expect?: BrowserExpectation }
  | { action: 'wait'; condition: 'page_idle' | 'text' | 'visible' | 'hidden'; value?: string; target?: BrowserSemanticTarget; timeoutMs?: number };

export interface BrowserAutomationDefinition {
  id: string;
  name: string;
  description?: string;
  allowedDomains: string[];
  risk: BrowserRiskLevel;
  inputs: Record<string, BrowserAutomationInputDefinition>;
  steps: BrowserAutomationStep[];
  successCriteria?: BrowserAutomationAssertion[];
  outputs?: Record<string, { target?: BrowserSemanticTarget; field: 'text' | 'value' | 'url' | 'title' | 'href' }>;
}

export interface BrowserAutomation {
  id: string;
  revision: number;
  verified: boolean;
  status: BrowserAutomationStatus;
  definition: BrowserAutomationDefinition;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BrowserAutomationRun {
  id: string;
  automationId: string;
  automationRevision: number;
  clientRequestId?: string;
  businessOutcome?: 'completed' | 'verified' | 'unknown';
  definition: BrowserAutomationDefinition;
  status: BrowserAutomationRunStatus;
  inputs: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  durationMs?: number;
}

export interface BrowserAutomationRunEvent {
  id: string;
  runId: string;
  seq: number;
  type: string;
  data?: unknown;
  createdAtMs: number;
}
