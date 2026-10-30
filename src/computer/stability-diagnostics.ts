import { randomUUID } from 'node:crypto';
import type { ComputerTarget } from '@xopcai/computer-control-contract';
import type { z } from 'zod';
import type { ComputerDiagnosticSchema, ComputerStabilitySchema } from './errors.js';

type Stability = z.infer<typeof ComputerStabilitySchema>;
type Snapshot = { target: ComputerTarget; summary: string; stateDigest: string; imageWidth: number; imageHeight: number };

/** Compare privately; retain only fixed change categories and bounded element positions, never values or hashes. */
export class ComputerStabilityTracker {
  private readonly changes = new Set<Stability['changes'][number]>();
  private readonly indices = new Set<number>();
  constructor(private readonly stage: Stability['stage'], private readonly action?: Stability['action']) {}
  deadline(): void { this.changes.add('deadline'); }
  compare(before: Snapshot, after: Snapshot): void {
    const a = before.target, b = after.target;
    if (a.appId !== b.appId || a.pid !== b.pid || a.processIdentity !== b.processIdentity || a.windowId !== b.windowId) this.changes.add('window_identity');
    if (a.geometryRevision !== b.geometryRevision || a.width !== b.width || a.height !== b.height) this.changes.add('window_geometry');
    if (before.imageWidth !== after.imageWidth || before.imageHeight !== after.imageHeight) this.changes.add('image_dimensions');
    if (before.summary !== after.summary) {
      try {
        const left = JSON.parse(before.summary), right = JSON.parse(after.summary);
        const ae = Array.isArray(left.elements) ? left.elements : [], be = Array.isArray(right.elements) ? right.elements : [];
        if (ae.length !== be.length) this.changes.add('accessibility_structure');
        if (left.text !== right.text) this.changes.add('accessibility_text');
        const groups = {
          accessibility_structure: ['role', 'ref', 'depth', 'parent_index'],
          accessibility_text: ['label', 'value', 'value_description'],
          accessibility_state: ['enabled', 'selected', 'keyboardFocused', 'inputAllowed', 'semanticActions', 'in_web_content'],
          accessibility_geometry: ['bounds', 'frame'],
        } as const;
        for (let i = 0; i < Math.max(ae.length, be.length); i++) {
          if (JSON.stringify(ae[i]) !== JSON.stringify(be[i]) && this.indices.size < 8 && i <= 16384) this.indices.add(i);
          for (const [category, fields] of Object.entries(groups)) {
            if (fields.some(field => JSON.stringify(ae[i]?.[field]) !== JSON.stringify(be[i]?.[field]))) {
              this.changes.add(category as keyof typeof groups);
            }
          }
        }
      } catch { this.changes.add('accessibility_structure'); }
    }
    if (before.stateDigest !== after.stateDigest && before.summary === after.summary
      && JSON.stringify(a) === JSON.stringify(b) && before.imageWidth === after.imageWidth && before.imageHeight === after.imageHeight) {
      this.changes.add('visual_or_unexposed_state');
    }
  }
  diagnostic(errorCode: string, samples: number): z.infer<typeof ComputerDiagnosticSchema> {
    return { errorCode, phase: this.stage === 'initial_capture' ? 'observe' : 'dispatch', diagnosticId: randomUUID(),
      stability: { stage: this.stage, samples, ...(this.action ? { action: this.action } : {}),
        changes: [...this.changes], changedElementIndices: [...this.indices] } };
  }
}
