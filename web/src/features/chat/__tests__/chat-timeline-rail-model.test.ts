import { describe, expect, it } from 'vitest';

import type { SessionTimelineItem } from '@/features/chat/session/session-manager';
import {
  buildTimeline,
  type ChatTimelineLabels,
} from '@/features/chat/timeline/chat-timeline-rail-model';

const labels: ChatTimelineLabels = {
  title: 'Timeline',
  turn: 'Turn {{count}}',
  messageFallback: 'Message',
  toolCount_one: '{{count}} tool',
  toolCount_other: '{{count}} tools',
  searchedWeb: 'Searched web',
  searchedMemory: 'Searched memory',
  searchedCode: 'Searched codebase',
  searched: 'Searched',
  readFile: 'Read file',
  runCommand: 'Ran command',
  listDirectory: 'Listed directory',
  writeFile: 'Wrote file',
  editFile: 'Edited file',
  openUrl: 'Opened URL',
  fetchUrl: 'Fetched URL',
  unknownTool: 'Tool {{name}}',
};

describe('chat timeline rail model', () => {
  it('uses semantic search labels for memory, code, and web tools', () => {
    const items: SessionTimelineItem[] = [
      {
        id: 'turn', kind: 'turn', role: 'user', title: 'Turn', preview: 'Search',
        depth: 0, turn: 1, displayIndex: 0, rowNumber: 1,
      },
      {
        id: 'memory', kind: 'tool', role: 'assistant', title: 'memory_search',
        depth: 1, turn: 1, rowNumber: 2, meta: { toolName: 'memory_search' },
      },
      {
        id: 'code', kind: 'tool', role: 'assistant', title: 'search_graph',
        depth: 1, turn: 1, rowNumber: 3,
        meta: { toolName: 'codebase-memory-mcp__search_graph' },
      },
      {
        id: 'web', kind: 'tool', role: 'assistant', title: 'web_search',
        depth: 1, turn: 1, rowNumber: 4, meta: { toolName: 'web_search' },
      },
    ];

    expect(buildTimeline(items, labels)[0]?.tools.map((tool) => tool.label)).toEqual([
      'Searched memory',
      'Searched codebase',
      'Searched web',
    ]);
  });

  it('groups tools and outline events under their user turn', () => {
    const items: SessionTimelineItem[] = [
      {
        id: 'row-1',
        kind: 'turn',
        role: 'user',
        title: 'Turn 1',
        preview: 'Investigate the failing build',
        depth: 0,
        turn: 1,
        displayIndex: 0,
        rowNumber: 1,
        timestamp: 1_700_000_000_000,
      },
      {
        id: 'row-2',
        kind: 'command',
        role: 'assistant',
        title: 'bash',
        preview: 'pnpm test',
        depth: 1,
        turn: 1,
        displayIndex: 1,
        rowNumber: 2,
        meta: { toolName: 'bash' },
      },
      {
        id: 'row-3',
        kind: 'context',
        title: 'context',
        preview: 'Session transcript compacted',
        depth: 1,
        turn: 1,
        rowNumber: 3,
      },
      {
        id: 'row-4',
        kind: 'branch',
        title: 'branch summary',
        preview: 'Forked from row 1',
        depth: 1,
        turn: 1,
        rowNumber: 4,
      },
      {
        id: 'row-5',
        kind: 'compaction',
        title: 'compaction',
        preview: 'Older turns compacted',
        depth: 1,
        turn: 1,
        rowNumber: 5,
      },
    ];

    const turns = buildTimeline(items, labels);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: 'row-1',
      messageIndex: 0,
      ordinal: 1,
      preview: 'Investigate the failing build',
      timestamp: 1_700_000_000_000,
    });
    expect(turns[0]?.tools).toEqual([
      { key: 'row-2:bash', label: 'bash', running: false },
    ]);
    expect(turns[0]?.events).toEqual([
      { key: 'row-3:context', label: 'Session transcript compacted', tone: 'context' },
      { key: 'row-4:branch', label: 'Forked from row 1', tone: 'branch' },
      { key: 'row-5:compaction', label: 'Older turns compacted', tone: 'compaction' },
    ]);
  });

  it('keeps global display indexes for paginated message anchoring', () => {
    const turns = buildTimeline(
      [
        {
          id: 'row-20',
          kind: 'turn',
          role: 'user',
          title: 'Turn 10',
          preview: 'Older message',
          depth: 0,
          turn: 10,
          displayIndex: 18,
          rowNumber: 20,
        },
        {
          id: 'row-42',
          kind: 'turn',
          role: 'user',
          title: 'Turn 20',
          preview: 'Recent message',
          depth: 0,
          turn: 20,
          displayIndex: 40,
          rowNumber: 42,
        },
      ],
      labels,
    );

    expect(turns.map((turn) => turn.messageIndex)).toEqual([18, 40]);
  });

  it('strips injected envelope timestamps from user turn previews', () => {
    const turns = buildTimeline(
      [
        {
          id: 'row-1',
          kind: 'turn',
          role: 'user',
          title: 'Turn 1',
          preview: '[2026-01-15 10:00 UTC] Investigate the timeline hover card',
          depth: 0,
          turn: 1,
          displayIndex: 0,
          rowNumber: 1,
        },
      ],
      labels,
    );

    expect(turns[0]?.preview).toBe('Investigate the timeline hover card');
  });
});
