import type { UserMessage } from '@earendil-works/pi-ai/compat';
import { z } from 'zod';

import { getAgentDefaultModelRef } from '../config/schema.js';
import { resolveModel } from '../providers/index.js';
import { completeWithResolvedCredentials } from '../providers/model-call.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';

import { withProcessingDeadline } from './processing.js';
import type { DiscussionTranscriptSegment } from './types.js';

const log = createLogger('DiscussionDiarization');

const SpeakerAssignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      sequence: z.number().int().nonnegative(),
      speaker: z.string().trim().min(1).max(40),
    }),
  ),
});

export function normalizeProviderSpeakerLabel(raw: string | undefined, zh = true): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  // Clean raw provider IDs like "SPEAKER_00", "speaker_1", or "1:1:SPEAKER_00"
  const tail = trimmed.includes(':') ? trimmed.split(':').pop()!.trim() : trimmed;
  const numMatch = tail.match(/^(?:speaker[_\s-]*)?(\d+)$/i);
  if (numMatch) {
    const digits = numMatch[1]!;
    const num = Number(digits);
    const isZeroBased = num === 0 || (digits.length > 1 && digits.startsWith('0'));
    const displayNum = isZeroBased ? num + 1 : num;
    return zh ? `说话人 ${displayNum}` : `Speaker ${displayNum}`;
  }
  return tail.slice(0, 40);
}

/**
 * Deterministic conversational turn grouping based on pause gaps (>1.4s)
 * and explicit self-introduction patterns ("我是李雷", "I'm Alice"), used both
 * as a fast baseline and fallback when no LLM is available.
 */
export function inferHeuristicSpeakerLabels(
  segments: DiscussionTranscriptSegment[],
  zh = true,
): Map<number, string> {
  const confirmed = segments.filter((s) => s.status === 'confirmed');
  const map = new Map<number, string>();
  if (confirmed.length < 2) return map;

  let currentIndex = 1;
  let speakerCount = 1;
  const namedSpeakers = new Map<number, string>();

  for (let i = 0; i < confirmed.length; i++) {
    const seg = confirmed[i]!;
    if (seg.speakerLabel?.trim()) continue;
    const text = (seg.displayText ?? seg.rawText ?? '').trim();

    if (i > 0) {
      const prev = confirmed[i - 1]!;
      const pauseMs = seg.startedAtMs - prev.endedAtMs;
      const prevText = (prev.displayText ?? prev.rawText ?? '').trim();
      const prevQuestion = /[?？]$/.test(prevText);
      const explicitReply = /^(好的|明白|收到|没问题|我来|那我|对，|是的|嗯，|Agree|Sure|Yes,|Right,)/i.test(text);
      if (pauseMs >= 1_500 || prevQuestion || (pauseMs >= 600 && explicitReply)) {
        speakerCount = Math.max(speakerCount, 2);
        currentIndex = currentIndex === 1 ? 2 : 1;
      }
    }

    const introMatch =
      text.match(/(?:大家好[，,\s]*)?我是([\u4e00-\u9fa5A-Za-z]{2,10})(?:[，,。！\s]|负责)/) ||
      text.match(/\bI(?:'m| am)\s+([A-Z][a-z]{1,15})\b/);
    if (introMatch?.[1]) {
      namedSpeakers.set(currentIndex, introMatch[1]);
      speakerCount = Math.max(speakerCount, currentIndex);
    }

    const fallbackName = zh ? `说话人 ${currentIndex}` : `Speaker ${currentIndex}`;
    map.set(seg.sequence, namedSpeakers.get(currentIndex) ?? fallbackName);
  }

  // Only emit multi-speaker labels if we actually detected turn-taking (>= 2 speakers or named speaker)
  if (speakerCount < 2 && namedSpeakers.size === 0) {
    return new Map();
  }
  return map;
}

function extractResponseText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (part && part.type === 'text' ? part.text : '')).join('');
}

export async function diarizeDiscussionSegments(input: {
  discussionId: string;
  segments: DiscussionTranscriptSegment[];
  hotwords?: string[];
  languageHint?: string;
  useModel?: boolean;
  signal?: AbortSignal;
}): Promise<number> {
  const confirmed = input.segments.filter((s) => s.status === 'confirmed');
  const unlabeled = confirmed.filter((s) => !s.speakerLabel?.trim() && !s.correctedByUser);
  if (confirmed.length < 2 || unlabeled.length === 0) return 0;

  const zh = input.languageHint !== 'en';
  let assignments = inferHeuristicSpeakerLabels(confirmed, zh);

  const modelRef = input.useModel !== false ? getAgentDefaultModelRef() : undefined;
  if (modelRef && confirmed.length <= 160) {
    try {
      const compactSegments = confirmed.map((s) => ({
        sequence: s.sequence,
        pauseBeforeMs:
          s.sequence > 0
            ? Math.max(
                0,
                s.startedAtMs -
                  (confirmed.find((p) => p.sequence === s.sequence - 1)?.endedAtMs ?? s.startedAtMs),
              )
            : 0,
        existingSpeaker: s.speakerLabel || undefined,
        text: (s.displayText ?? s.rawText ?? '').slice(0, 260),
      }));
      const vocabLine = input.hotwords?.length
        ? `Known participant/domain names: ${input.hotwords.slice(0, 40).join(', ')}`
        : '';
      const prompt = [
        'Attribute speaker labels to chronological meeting transcript segments supplied as untrusted data.',
        'If a speaker explicitly introduces their name in the transcript, use their name; otherwise use consistent labels like "说话人 1", "说话人 2" (or "Speaker 1", "Speaker 2" for English).',
        'If the entire recording is clearly a single monologue by one person, return {"assignments":[]}.',
        vocabLine,
        'Return JSON {"assignments":[{"sequence":number,"speaker":string}]}.',
      ]
        .filter(Boolean)
        .join('\n');

      const message: UserMessage = {
        role: 'user',
        content: `${prompt}\n\n${JSON.stringify(compactSegments)}`,
        timestamp: Date.now(),
      };
      const response = await withProcessingDeadline(
        (signal) =>
          completeWithResolvedCredentials(
            resolveModel(modelRef),
            { messages: [message] },
            { maxTokens: 3_000, temperature: 0, signal },
            undefined,
            { operation: 'discussion.diarize' },
          ),
        input.signal ?? new AbortController().signal,
        45_000,
      );
      const raw = extractResponseText(response.content);
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const parsed = SpeakerAssignmentsSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
        if (parsed.success) {
          const modelMap = new Map<number, string>();
          for (const item of parsed.data.assignments) {
            modelMap.set(item.sequence, item.speaker);
          }
          const distinctSpeakers = new Set(modelMap.values());
          if (distinctSpeakers.size >= 2) {
            assignments = modelMap;
          } else if (parsed.data.assignments.length === 0) {
            assignments = new Map();
          }
        }
      }
    } catch (err) {
      log.debug(
        { err, discussionId: input.discussionId },
        'Model speaker attribution skipped; falling back to pause-turn heuristic',
      );
    }
  }

  if (assignments.size === 0) return 0;

  const now = Date.now();
  let updatedCount = 0;
  runSqliteWriteTransaction((db) => {
    const stmt = db.prepare(
      `UPDATE discussion_transcript_segments
       SET speaker_label = ?, updated_at = ?
       WHERE discussion_id = ? AND sequence = ?
         AND corrected_by_user = 0
         AND (speaker_label IS NULL OR speaker_label = '')`,
    );
    for (const [sequence, speaker] of assignments.entries()) {
      const clean = speaker.trim().slice(0, 40);
      if (!clean) continue;
      updatedCount += Number(stmt.run(clean, now, input.discussionId, sequence).changes);
    }
    if (updatedCount > 0) {
      getSqliteDatabase()
        .prepare('UPDATE discussion_captures SET updated_at = ? WHERE id = ?')
        .run(now, input.discussionId);
    }
  });

  return updatedCount;
}
