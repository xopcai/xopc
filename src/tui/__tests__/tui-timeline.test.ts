import { describe, expect, it } from 'vitest';

import type { SessionTimelineItem } from '../../session/transcript-outline.js';
import {
  buildTuiTimelineTurns,
  findNearestTimelineTurnByDisplayIndex,
  findTimelineTurnByNumber,
} from '../tui-timeline.js';

describe('TUI timeline model', () => {
  it('builds user turns with previews and deduplicated tool counts', () => {
    const items: SessionTimelineItem[] = [
      {
        id: 'u1',
        kind: 'turn',
        role: 'user',
        title: 'Turn 1',
        preview: 'Investigate reconnect behavior',
        depth: 0,
        turn: 1,
        displayIndex: 0,
      },
      {
        id: 'a1-tool',
        kind: 'tool',
        title: 'read_file',
        depth: 1,
        turn: 1,
        displayIndex: 1,
        meta: { toolName: 'read_file' },
      },
      {
        id: 'a1-tool',
        kind: 'tool',
        title: 'read_file',
        depth: 1,
        turn: 1,
        displayIndex: 1,
        meta: { toolName: 'read_file' },
      },
      {
        id: 'u2',
        kind: 'turn',
        role: 'user',
        title: 'Turn 2',
        preview: 'Ship timeline command',
        depth: 0,
        turn: 2,
        displayIndex: 2,
      },
      {
        id: 'a2-command',
        kind: 'command',
        title: 'pnpm test',
        depth: 1,
        turn: 2,
        displayIndex: 3,
        status: 'running',
      },
    ];

    const turns = buildTuiTimelineTurns(items);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      turn: 1,
      displayIndex: 0,
      preview: 'Investigate reconnect behavior',
      toolCount: 1,
      running: false,
    });
    expect(turns[1]).toMatchObject({
      turn: 2,
      displayIndex: 2,
      preview: 'Ship timeline command',
      toolCount: 1,
      running: true,
    });
    expect(findTimelineTurnByNumber(turns, 2)?.id).toBe('u2');
    expect(findNearestTimelineTurnByDisplayIndex(turns, 3)?.id).toBe('u2');
  });
});

