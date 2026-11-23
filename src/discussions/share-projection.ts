import { buildNoteAttachmentRef } from '../notes/attachment-ref.js';
import type { Note } from '../notes/types.js';

import {
  getDiscussionCaptureByNoteId,
  getLatestDiscussionOrganization,
  listDiscussionTranscriptSegments,
} from './repository.js';

export interface DiscussionShareOptions {
  includeSummary?: boolean;
  includeTranscript?: boolean;
  includePersonalNotes?: boolean;
}

export function parseDiscussionShareOptions(raw: unknown): DiscussionShareOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const options: DiscussionShareOptions = {};
  if (typeof obj.includeSummary === 'boolean') options.includeSummary = obj.includeSummary;
  if (typeof obj.includeTranscript === 'boolean') options.includeTranscript = obj.includeTranscript;
  if (typeof obj.includePersonalNotes === 'boolean') options.includePersonalNotes = obj.includePersonalNotes;
  return Object.keys(options).length > 0 ? options : undefined;
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Projects a Discussion-backed Note into a self-contained Note view for public/hosted sharing.
 * Regular notes without a backing discussion capture are returned unchanged.
 */
export function projectDiscussionNoteForShare(
  note: Note,
  options?: DiscussionShareOptions,
  requestedAttachmentIds?: string[],
): Note {
  let capture: ReturnType<typeof getDiscussionCaptureByNoteId> = null;
  try {
    capture = getDiscussionCaptureByNoteId(note.id);
  } catch {
    return note;
  }
  if (!capture) return note;

  const organization = getLatestDiscussionOrganization(capture.id)?.organization;
  const confirmedSegments = listDiscussionTranscriptSegments(capture.id).filter(
    (segment) => segment.status === 'confirmed',
  );

  const includeSummary = options?.includeSummary ?? true;
  const includeTranscript = options?.includeTranscript ?? false;
  const personalBody = note.markdown.trim();
  const includePersonalNotes = options?.includePersonalNotes ?? Boolean(personalBody);

  const sections: string[] = [];

  const audioId = !capture.audioDeletedAt ? capture.audioAttachmentId : undefined;
  const wantsAudio = Boolean(audioId && requestedAttachmentIds?.includes(audioId));
  if (wantsAudio && audioId) {
    sections.push(`[录音回放](${buildNoteAttachmentRef(note.id, audioId)})`);
  }

  if (includeSummary) {
    if (organization) {
      if (organization.summary.trim()) {
        sections.push(`## 纪要摘要\n\n${organization.summary.trim()}`);
      }
      const keyPoints = (organization.keyPointEvidence?.map((item) => item.text) ?? organization.keyPoints)
        .map((text) => text.trim())
        .filter(Boolean);
      if (keyPoints.length > 0) {
        sections.push(`## 重点结论\n\n${keyPoints.map((text) => `- ${text}`).join('\n')}`);
      }
      const decisions = (organization.decisions ?? []).filter((item) => !item.ignored && !item.supersededBy);
      if (decisions.length > 0) {
        sections.push(
          `## 已决定事项\n\n${decisions.map((item) => `- ${typeof item === 'string' ? item : item.text}`).join('\n')}`,
        );
      }
      const actions = (organization.actionItems ?? []).filter((item) => !item.ignored && !item.supersededBy);
      if (actions.length > 0) {
        sections.push(
          `## 下一步行动\n\n${actions
            .map((item) => {
              const meta = [item.owner, item.dueDate].filter(Boolean).join(' · ');
              return `- [ ] ${item.title}${meta ? `（${meta}）` : ''}`;
            })
            .join('\n')}`,
        );
      }
      const risks = (organization.risks ?? []).filter((item) => !item.ignored && !item.supersededBy);
      if (risks.length > 0) {
        sections.push(
          `## 风险与阻塞\n\n${risks.map((item) => `- ${typeof item === 'string' ? item : item.text}`).join('\n')}`,
        );
      }
      const questions = (organization.openQuestions ?? []).filter((item) => !item.ignored && !item.supersededBy);
      if (questions.length > 0) {
        sections.push(
          `## 待确认问题\n\n${questions.map((item) => `- ${typeof item === 'string' ? item : item.text}`).join('\n')}`,
        );
      }
    } else if (!includeTranscript) {
      const fallbackText =
        capture.canonicalTranscript?.trim()
        || confirmedSegments
          .map((seg) => (seg.displayText ?? seg.rawText ?? '').trim())
          .filter(Boolean)
          .join('\n\n');
      if (fallbackText) {
        sections.push(`## 录音内容\n\n${fallbackText}`);
      }
    }
  }

  if (includePersonalNotes && personalBody) {
    sections.push(sections.length > 0 ? `## 补充笔记\n\n${personalBody}` : personalBody);
  }

  if (includeTranscript) {
    if (confirmedSegments.length > 0) {
      const transcriptLines = confirmedSegments
        .map((seg) => {
          const text = (seg.displayText ?? seg.rawText ?? '').trim();
          if (!text) return '';
          const speaker = seg.speakerLabel ? ` **${seg.speakerLabel}**` : '';
          return `- \`${formatClock(seg.startedAtMs)}\`${speaker} ${text}`;
        })
        .filter(Boolean);
      if (transcriptLines.length > 0) {
        sections.push(`## 逐字稿\n\n${transcriptLines.join('\n')}`);
      }
    } else if (capture.canonicalTranscript?.trim()) {
      sections.push(`## 逐字稿\n\n${capture.canonicalTranscript.trim()}`);
    }
  }

  const rawTitle = note.title?.trim() ?? '';
  const isPlaceholderTitle = !rawTitle || /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rawTitle);
  const resolvedTitle = isPlaceholderTitle
    ? organization?.title?.trim() || capture.generatedTitle?.trim() || '语音笔记'
    : rawTitle;

  return {
    ...note,
    title: resolvedTitle,
    markdown: sections.join('\n\n'),
  };
}
