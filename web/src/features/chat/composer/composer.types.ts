import type { MutableRefObject } from 'react';

import type { Attachment } from '@/features/chat/attachments/attachment-utils';

// ── Thinking level ──────────────────────────────────────────────────

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'adaptive';

// ── Wire attachment (API payload shape) ─────────────────────────────

export interface WireAttachment {
  id?: string;
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  uri?: string;
  bucket?: string;
  path?: string;
  /** Recorder / client-known length (seconds). Helps WebMs that report NaN duration in `<audio>`. */
  durationSeconds?: number;
}

export interface ComposerContextRef {
  kind: 'note';
  sourceId: string;
  expectedVersion: string;
  title: string;
}

export type WireContextRef = Pick<ComposerContextRef, 'kind' | 'sourceId' | 'expectedVersion'>;

/** False rejects a submission without consuming the current composer draft. */
export type ComposerSendHandler = (text: string, attachments?: WireAttachment[], thinkingLevel?: string, contextRefs?: ComposerContextRef[]) => void | boolean | Promise<void | boolean>;

export const MAX_COMPOSER_CONTEXT_REFS = 5;

// ── Draft harvest result (shared by send / flush / interrupt) ───────

export interface ComposerDraft {
  text: string;
  attachments: WireAttachment[];
  contextRefs: ComposerContextRef[];
}

// ── Editor reset options ────────────────────────────────────────────

export interface ResetEditorOptions {
  /** Text to set after reset (default: empty). */
  nextText?: string;
  /** Where to place the caret (default: end of `nextText`). */
  caretOffset?: number;
  /** Focus the editor after reset (default: false). */
  focus?: boolean;
}

// ── Refs shared across hooks ────────────────────────────────────────

export interface ComposerSharedRefs {
  editorRef: MutableRefObject<HTMLDivElement | null>;
  valueRef: MutableRefObject<string>;
  attachmentsRef: MutableRefObject<Attachment[]>;
  thinkingLevelRef: MutableRefObject<string>;
  busyRef: MutableRefObject<boolean>;
}

// ── Interpolation helper (used for notification templates) ──────────

export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}
