import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import { extractUserMessagePlainText } from '@/features/chat/messages/user-message-plain-text';
import { stripStartupContextForDisplay } from '@/features/chat/messages/wire-text-scrub';

const samplePrelude = `[Startup context loaded by runtime]
Bootstrap files like the global user profile, SOUL.md, and MEMORY.md are already provided separately when eligible.
Runtime-provided context is available for this new session.
Do not claim you manually read files unless the user asks.`;

describe('stripStartupContextForDisplay', () => {
  it('removes startup prelude and keeps user text', () => {
    const input = `${samplePrelude}\n\n[2026-06-03 14:32 UTC] 使用 workflow 帮我探索下 /path`;
    expect(stripStartupContextForDisplay(input)).toBe(
      '[2026-06-03 14:32 UTC] 使用 workflow 帮我探索下 /path',
    );
  });

  it('leaves normal messages unchanged', () => {
    const input = '使用 workflow 帮我探索下 /path';
    expect(stripStartupContextForDisplay(input)).toBe(input);
  });

  it('does not strip marker when it appears mid-message', () => {
    const input = 'quote [Startup context loaded by runtime] in text';
    expect(stripStartupContextForDisplay(input)).toBe(input);
  });
});

describe('normalizeAgentMessages startup context', () => {
  it('strips startup prelude from persisted user rows', () => {
    const expanded = `${samplePrelude}\n\n使用 workflow 帮我探索下 /path`;
    const ui = normalizeAgentMessages([
      {
        role: 'user',
        content: [{ type: 'text', text: expanded }],
        timestamp: 1,
      },
    ]);
    expect(ui).toHaveLength(1);
    expect(extractUserMessagePlainText(ui[0]?.content)).toBe('使用 workflow 帮我探索下 /path');
  });
});
