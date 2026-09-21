import { z } from 'zod';
import type { ComputerAction, ComputerObservation, ComputerReceipt } from '@xopcai/computer-control-contract';

export const ComputerExpectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('field'), label: z.string().min(1).max(300), value: z.string().max(4000) }).strict(),
  z.object({ kind: z.literal('selected'), label: z.string().min(1).max(300) }).strict(),
]);
export type ComputerExpectation = z.infer<typeof ComputerExpectationSchema>;
export type ComputerVerification = { status: 'satisfied' | 'not_met' | 'unavailable'; source: 'accessibility'; scope: 'expectation'; preexisting?: boolean };

/** Verify only caller-specified conditions against scoped native evidence, never model prose. */
export function verifyComputerExpectation(expectation: ComputerExpectation | undefined, observation?: ComputerObservation, before?: ComputerObservation): ComputerVerification | undefined {
  if (!expectation) return;
  const result = (status: ComputerVerification['status']): ComputerVerification => ({ status, source: 'accessibility', scope: 'expectation' });
  if (!observation) return result('unavailable');
  try {
    const data = JSON.parse(observation.summary);
    if (!Array.isArray(data.elements) || !data.elements.some((e: Record<string, unknown>) => e.role === 'AXWindow')) return result('unavailable');
    if (expectation.kind === 'text') {
      if (typeof data.text !== 'string' || !data.text) return result('unavailable');
      const verification = result(data.text.includes(expectation.text) ? 'satisfied' : data.truncated ? 'unavailable' : 'not_met');
      if (verification.status === 'satisfied' && before && verifyComputerExpectation(expectation, before)?.status === 'satisfied') verification.preexisting = true;
      return verification;
    }
    if (data.truncated === true) return result('unavailable');
    if (expectation.kind === 'selected') {
      const candidates = data.elements.filter((e: Record<string, unknown>) => e.label === expectation.label && typeof e.selected === 'boolean');
      if (candidates.length !== 1) return result('unavailable');
      return result(candidates[0].selected ? 'satisfied' : 'not_met');
    }
    const fields = data.elements.filter((e: Record<string, unknown>) => ['AXTextField', 'AXTextArea'].includes(String(e.role)) && e.label === expectation.label);
    if (fields.length !== 1 || typeof fields[0].value !== 'string' || fields[0].in_web_content === true) return result('unavailable');
    return result(fields[0].value === expectation.value ? 'satisfied' : 'not_met');
  } catch { return result('unavailable'); }
}

export interface ComputerHistoryEntry {
  goal: string;
  action: ComputerAction['kind'];
  actionPreview: string;
  dispatch: ComputerReceipt['dispatch'];
  outcome: ComputerReceipt['outcome'];
  after: string;
  afterStateDigest?: string;
  verification?: ComputerVerification;
}

/** Session-local bounded text only. Screenshots and provider responses never enter history. */
export class ComputerTaskState {
  readonly history: ComputerHistoryEntry[] = [];
  private repeated?: { key: string; count: number };

  assertProgress(action: ComputerAction, observation: ComputerObservation): void {
    if (action.kind === 'wait') return;
    const key = JSON.stringify([action, observation.stateDigest]);
    if (this.repeated?.key === key && this.repeated.count >= 2) throw new Error('COMPUTER_NO_PROGRESS');
  }

  record(goal: string, action: ComputerAction, before: ComputerObservation, receipt: ComputerReceipt,
    after?: ComputerObservation, verification?: ComputerVerification): void {
    if (receipt.dispatch !== 'completed') return;
    const key = JSON.stringify([action, before.stateDigest]);
    if (action.kind !== 'wait' && after?.stateDigest === before.stateDigest) {
      this.repeated = { key, count: this.repeated?.key === key ? this.repeated.count + 1 : 1 };
    } else this.repeated = undefined;
    this.history.push({ goal: goal.slice(0, 1000), action: action.kind, actionPreview: JSON.stringify(action).slice(0, 1000),
      dispatch: receipt.dispatch, outcome: receipt.outcome, after: (after?.summary ?? '').slice(0, 2000),
      ...(after ? { afterStateDigest: after.stateDigest } : {}), verification });
    if (this.history.length > 6) this.history.shift();
  }

  clear(): void { this.history.length = 0; this.repeated = undefined; }
}
