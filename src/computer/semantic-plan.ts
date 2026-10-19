import { z } from 'zod';
import type { ComputerAction } from '@xopcai/computer-control-contract';
import type { ComputerHistoryEntry } from './task-state.js';

// Plans describe native buttons, never stored refs, coordinates or executable text.
export const ComputerButtonPlanSchema = z.object({
  kind: z.literal('button_plan'),
  steps: z.array(z.object({
    label: z.string().min(1).max(300),
    when: z.union([z.object({ text: z.string().min(1).max(1000) }).strict(), z.object({
      role: z.literal('AXStaticText'),
      label: z.string().max(300),
      value: z.string().max(1000).optional(),
    }).strict(), z.object({
      role: z.enum(['AXTextField', 'AXTextArea']), label: z.string().max(300), value: z.string().max(1000),
    }).strict()]),
  }).strict()).min(2).max(6),
}).strict();
type ButtonPlan = z.infer<typeof ComputerButtonPlanSchema>;
const NativeContextSchema = z.object({
  text: z.string().optional(), truncated: z.boolean().optional(),
  elements: z.array(z.object({
    role: z.string(), label: z.string().optional(), value: z.unknown().optional(), ref: z.string().optional(),
    enabled: z.boolean().optional(), in_web_content: z.boolean().optional(), semanticActions: z.array(z.string()).optional(),
  })).max(180),
});
const displayText = (value: unknown) => typeof value === 'string' ? value.replace(/[\u200e\u200f\u2066-\u2069]/g, '') : undefined;

/** A call-local conditional plan. Every yielded action still goes through broker validation. */
export class ComputerButtonPlan {
  private steps: ButtonPlan['steps'] = [];
  private goal?: string;
  private awaiting?: { preview: string; digest: string };
  get pending(): boolean { return this.steps.length > 0; }
  reset(): void { this.steps = []; this.goal = undefined; this.awaiting = undefined; }
  install(plan: ButtonPlan, goal: string, limit: number): void {
    this.reset();
    if (plan.steps.length > limit) throw new Error('COMPUTER_INVALID_MODEL_OUTPUT');
    this.goal = goal;
    this.steps = [...plan.steps];
  }
  next(input: { goal: string; summary: string; stateDigest?: string; history?: readonly ComputerHistoryEntry[]; maxPlanActions?: number }): ComputerAction | undefined {
    if (!this.steps.length) return;
    const reject = () => { this.reset(); return undefined; };
    if (!input.maxPlanActions || this.goal !== input.goal || !input.stateDigest) return reject();
    if (this.awaiting) {
      const last = input.history?.at(-1);
      if (last?.dispatch !== 'completed' || last.actionPreview !== this.awaiting.preview
        || last.afterStateDigest !== input.stateDigest || this.awaiting.digest === input.stateDigest) return reject();
    }
    try {
      const data = NativeContextSchema.parse(JSON.parse(input.summary));
      if (!data.elements.some((e) => e.role === 'AXWindow')) return reject();
      const step = this.steps[0];
      const when = step.when;
      if ('text' in when) {
        // Some native drivers expose noninteractive text only in the scoped AX
        // markdown. Match a complete positive static-text value, never a substring
        // or an arbitrary line containing a control's label. Partial coverage
        // cannot establish absence; no such inference is made here.
        const values = typeof data.text === 'string' ? [...data.text.matchAll(/^\s*- AXStaticText = "([^"\n]*)"\s*$/gm)] : [];
        if (values.filter(match => displayText(match[1]) === displayText(when.text)).length !== 1) return reject();
      } else {
        if (data.truncated === true) return reject();
        const guards = data.elements.filter((e) => e.role === when.role && displayText(e.label) === displayText(when.label));
        if (guards.length !== 1 || guards[0].in_web_content === true
          || (when.value !== undefined && displayText(guards[0].value) !== displayText(when.value))) return reject();
      }
      const buttons = data.elements.filter((e) => e.role === 'AXButton' && e.label === step.label);
      if (buttons.length !== 1 || buttons[0].enabled === false || buttons[0].in_web_content === true
        || typeof buttons[0].ref !== 'string' || !buttons[0].semanticActions?.includes('activate')) return reject();
      const action: ComputerAction = { kind: 'activate', ref: buttons[0].ref };
      this.steps.shift();
      this.awaiting = { preview: JSON.stringify(action), digest: input.stateDigest };
      return action;
    } catch { return reject(); }
  }
}
