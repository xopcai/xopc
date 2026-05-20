import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '../system-prompt.js';

describe('system-prompt Project Context', () => {
  it('includes stable Project Context with SOUL guidance', () => {
    const prompt = buildSystemPrompt('/workspace/main', {
      contextFiles: [
        { path: 'profile/SOUL.md', content: 'Be kind.' },
        { path: 'profile/AGENTS.md', content: 'Follow rules.' },
      ],
    });
    expect(prompt).toContain('# Project Context');
    expect(prompt).toContain('embody its persona');
    expect(prompt).toContain('## profile/SOUL.md');
    expect(prompt).toContain('Be kind.');
  });

  it('places HEARTBEAT in Dynamic Project Context', () => {
    const prompt = buildSystemPrompt('/workspace/main', {
      heartbeatEnabled: true,
      contextFiles: [
        { path: 'profile/AGENTS.md', content: 'rules' },
        { path: 'profile/HEARTBEAT.md', content: 'check inbox' },
      ],
    });
    const dynamicIndex = prompt.indexOf('# Dynamic Project Context');
    const stableIndex = prompt.indexOf('# Project Context');
    expect(dynamicIndex).toBeGreaterThan(stableIndex);
    expect(prompt.slice(dynamicIndex)).toContain('HEARTBEAT.md');
  });
});
