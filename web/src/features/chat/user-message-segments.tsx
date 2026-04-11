import { memo, useMemo } from 'react';

import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { skillWireTokenRe } from '@/features/chat/skill-wire-pattern';

export type SkillWireSegment = { kind: 'text'; text: string } | { kind: 'skill'; name: string };

export function parseSkillWireSegments(text: string): SkillWireSegment[] {
  const out: SkillWireSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = skillWireTokenRe();
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', text: text.slice(last, m.index) });
    }
    out.push({ kind: 'skill', name: m[1] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ kind: 'text', text: text.slice(last) });
  }
  if (out.length === 0) {
    out.push({ kind: 'text', text });
  }
  return out;
}

/**
 * User bubble: render `/skill:name` as inline pills (composer parity); otherwise render Markdown as usual.
 */
export const UserMessageSegments = memo(function UserMessageSegments({ text }: { text: string }) {
  const parts = useMemo(() => parseSkillWireSegments(text), [text]);
  const hasSkill = parts.some((p) => p.kind === 'skill');

  if (!hasSkill) {
    return (
      <div className="markdown-content min-w-0">
        <MarkdownView content={text} compact />
      </div>
    );
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1 [text-align:inherit]">
      {parts.map((p, i) =>
        p.kind === 'skill' ? (
          <span key={`skill-${i}-${p.name}`} className="chat-skill-pill max-w-full shrink-0" data-skill={p.name}>
            /{p.name}
          </span>
        ) : p.text ? (
          <span key={`txt-${i}`} className="min-w-0 whitespace-pre-wrap break-words text-fg">
            {p.text}
          </span>
        ) : null,
      )}
    </span>
  );
});
