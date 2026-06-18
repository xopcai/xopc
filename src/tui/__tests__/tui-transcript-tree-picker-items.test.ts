import { describe, expect, it } from 'vitest';

import {
  sessionTreeSelectItems,
  transcriptTreeSelectItems,
  userMessageForkSelectItems,
} from '../tui-picker-overlay.js';
import { buildTuiTranscriptTree } from '../tui-transcript-tree.js';

describe('tui transcript tree picker items', () => {
it('builds grouped session tree picker rows with fork lineage', () => {
    const items = sessionTreeSelectItems(
      [
        {
          key: 'agent:main:main',
          displayName: 'Main chat',
          updatedAt: 30,
          messageCount: 4,
        },
        {
          key: 'agent:main:telegram:direct:alice',
          displayName: 'Alice fork',
          updatedAt: 20,
          messageCount: 2,
          forkedFromSessionKey: 'agent:main:main',
        },
        {
          key: 'legacy-session',
          updatedAt: 10,
        },
      ],
      'agent:main:main',
    );

    const current = items.find((item) => item.value === 'agent:main:main');
    expect(current?.label).toBe('* Main chat');
    expect(current?.description).toContain('main/main');
    expect(current?.description).toContain('4 msgs');

    const fork = items.find((item) => item.value === 'agent:main:telegram:direct:alice');
    expect(fork?.label).toBe('  Alice fork');
    expect(fork?.description).toContain('main/telegram');
    expect(fork?.description).toContain('forked from Main chat');
    expect(fork?.searchText).toContain('Main chat');

    const legacy = items.find((item) => item.value === 'legacy-session');
    expect(legacy?.description).toContain('legacy/legacy-session');
  });

  it('builds transcript tree picker rows with indentation and searchable metadata', () => {
    const items = transcriptTreeSelectItems([
      {
        id: 'row-1',
        depth: 0,
        label: 'user',
        role: 'user',
        userLabel: 'important',
        labelTimestamp: '2026-06-17T10:05:00.000Z',
        turn: 1,
        preview: 'Plan this change',
      },
      {
        id: 'row-2',
        parentId: 'row-1',
        depth: 1,
        label: 'assistant',
        role: 'assistant',
        isCurrentLeaf: true,
        turn: 1,
        preview: 'Implementation details',
      },
    ]);

    expect(items[0]).toMatchObject({
      value: 'row-1',
      label: '- #1 [important] user: Plan this change',
      description: 'row-1',
    });
    expect(items[0]?.searchText).toContain('important');
    expect(items[0]?.searchText).toContain('2026-06-17T10:05:00.000Z');
    expect(items[1]?.label).toBe('  └─ • #1 assistant: Implementation details');
    expect(items[1]?.searchText).toContain('row-1');
    expect(items[1]?.searchText).toContain('active current');
    expect(items[1]?.searchText).toContain('Implementation details');
  });

  it('renders active-path markers from builder-produced transcript entries', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'Plan this change' },
      { role: 'assistant', content: 'Implementation details' },
      { type: 'label', targetId: 'row-1', label: 'bookkeeping' },
    ] as never);
    const items = transcriptTreeSelectItems(entries);

    expect(items[0]?.label).toBe('- • #1 [bookkeeping] user: Plan this change');
    expect(items[1]?.label).toBe('  ├─ • #1 assistant: Implementation details');
    expect(items[1]?.searchText).toContain('active current');
    expect(items[2]?.label).toBe('  └─ #1 [label: bookkeeping]');
  });

  it('marks transcript tree picker rows that can fold or are folded', () => {
    const items = transcriptTreeSelectItems(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      {
        foldedIds: new Set(['row-1']),
        foldableIds: new Set(['row-1']),
      },
    );

    expect(items[0]?.label).toBe('⊞ - #1 user: Plan this change');

    const expanded = transcriptTreeSelectItems(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
      ],
      { foldableIds: new Set(['row-1']) },
    );
    expect(expanded[0]?.label).toBe('⊟ - #1 user: Plan this change');
  });

  it('renders nested transcript tree rows with pi-style gutters', () => {
    const items = transcriptTreeSelectItems([
      {
        id: 'root',
        depth: 0,
        label: 'user',
        role: 'user',
        turn: 1,
        preview: 'Root prompt',
      },
      {
        id: 'branch-a',
        parentId: 'root',
        depth: 1,
        label: 'user',
        role: 'user',
        turn: 2,
        preview: 'Branch A',
      },
      {
        id: 'branch-a-child',
        parentId: 'branch-a',
        depth: 2,
        label: 'assistant',
        role: 'assistant',
        turn: 2,
        preview: 'Branch A answer',
      },
      {
        id: 'branch-b',
        parentId: 'root',
        depth: 1,
        label: 'user',
        role: 'user',
        turn: 3,
        preview: 'Branch B',
      },
    ]);

    expect(items[1]?.label).toBe('  ├─ #2 user: Branch A');
    expect(items[2]?.label).toBe('  │  └─ #2 assistant: Branch A answer');
    expect(items[3]?.label).toBe('  └─ #3 user: Branch B');
  });

  it('reattaches transcript tree rows to the nearest visible ancestor when rendering filtered gutters', () => {
    const allEntries = [
      {
        id: 'row-1',
        depth: 0,
        label: 'user',
        role: 'user',
        turn: 1,
        preview: 'Root prompt',
      },
      {
        id: 'row-2',
        parentId: 'row-1',
        depth: 1,
        label: 'context',
        turn: 1,
        preview: 'hidden context',
      },
      {
        id: 'row-3',
        parentId: 'row-2',
        depth: 2,
        label: 'assistant',
        role: 'assistant',
        turn: 1,
        preview: 'Visible answer',
      },
    ];
    const items = transcriptTreeSelectItems([allEntries[0]!, allEntries[2]!], { allEntries });

    expect(items[0]?.label).toBe('- #1 user: Root prompt');
    expect(items[1]?.label).toBe('  └─ #1 assistant: Visible answer');
  });

  it('renders transcript tree rows with hidden parents as visible roots', () => {
    const allEntries = [
      {
        id: 'row-1',
        depth: 0,
        label: 'user',
        role: 'user',
        turn: 1,
        preview: 'Root prompt',
      },
      {
        id: 'row-2',
        parentId: 'row-1',
        depth: 1,
        label: 'assistant',
        role: 'assistant',
        userLabel: 'important',
        turn: 1,
        preview: 'Only visible child',
      },
    ];
    const items = transcriptTreeSelectItems([allEntries[1]!], { allEntries });

    expect(items[0]?.label).toBe('- #1 [important] assistant: Only visible child');
  });

  it('renders empty assistant and tool transcript rows with pi-style placeholders', () => {
    const items = transcriptTreeSelectItems([
      {
        id: 'row-1',
        depth: 0,
        label: 'assistant',
        role: 'assistant',
        turn: 1,
        preview: '',
      },
      {
        id: 'row-2',
        depth: 1,
        label: 'tool:read_file',
        role: 'toolResult',
        turn: 1,
      },
    ]);

    expect(items[0]?.label).toBe('- #1 assistant: (no content)');
    expect(items[1]?.label).toBe('  └─ #1 [read_file]');
  });

  it('renders tool result rows as compact tool labels while keeping result text searchable', () => {
    const items = transcriptTreeSelectItems([
      {
        id: 'row-1',
        depth: 1,
        label: 'tool:read_file',
        role: 'toolResult',
        turn: 1,
        preview: 'file contents',
      },
    ]);

    expect(items[0]?.label).toBe('- #1 [read_file]');
    expect(items[0]?.searchText).toContain('file contents');
  });

  it('renders assistant aborted and error transcript rows with pi-style state text', () => {
    const items = transcriptTreeSelectItems([
      {
        id: 'row-1',
        depth: 0,
        label: 'assistant',
        role: 'assistant',
        turn: 1,
        preview: '(aborted)',
      },
      {
        id: 'row-2',
        depth: 1,
        label: 'assistant',
        role: 'assistant',
        turn: 1,
        preview: 'provider unavailable',
      },
    ]);

    expect(items[0]?.label).toBe('- #1 assistant: (aborted)');
    expect(items[1]?.label).toBe('  └─ #1 assistant: provider unavailable');
  });

  it('renders metadata transcript rows with pi-style bracket labels', () => {
    const items = transcriptTreeSelectItems([
      {
        id: 'row-1',
        depth: 1,
        label: 'model_change',
        turn: 1,
        preview: 'openai/gpt-5',
      },
      {
        id: 'row-2',
        depth: 1,
        label: 'thinking_level_change',
        turn: 1,
        preview: 'thinking: high',
      },
      {
        id: 'row-3',
        depth: 1,
        label: 'session_info',
        turn: 1,
        preview: 'title: Demo session',
      },
      {
        id: 'row-4',
        depth: 1,
        label: 'label:important',
        turn: 1,
        preview: 'label: important',
      },
      {
        id: 'row-5',
        depth: 1,
        label: 'compaction',
        turn: 1,
        preview: 'previous context summarized',
      },
      {
        id: 'row-6',
        depth: 1,
        label: 'branch_summary',
        turn: 1,
        preview: 'returned from branch',
      },
      {
        id: 'row-7',
        depth: 1,
        label: 'custom:skill',
        turn: 1,
        preview: 'skill: ran skill',
      },
      {
        id: 'row-8',
        depth: 1,
        label: 'bashExecution',
        role: 'bashExecution',
        turn: 1,
        preview: 'pnpm test',
      },
    ]);

    expect(items[0]?.label).toBe('- #1 [model: gpt-5]');
    expect(items[1]?.label).toBe('- #1 [thinking: high]');
    expect(items[2]?.label).toBe('- #1 [title: Demo session]');
    expect(items[3]?.label).toBe('- #1 [label: important]');
    expect(items[4]?.label).toBe('- #1 [compaction: previous context summarized]');
    expect(items[5]?.label).toBe('- #1 [branch summary]: returned from branch');
    expect(items[6]?.label).toBe('- #1 [custom:skill]: skill: ran skill');
    expect(items[7]?.label).toBe('- #1 [bash]: pnpm test');
    expect(items[5]?.searchText).toContain('branch summary');
    expect(items[7]?.searchText).toContain('[bash]: pnpm test');
  });

  it('builds user-message fork picker rows from transcript entries only', () => {
    const items = userMessageForkSelectItems([
      {
        id: 'row-1',
        depth: 0,
        label: 'user',
        role: 'user',
        turn: 1,
        preview: 'First prompt',
      },
      {
        id: 'row-2',
        parentId: 'row-1',
        depth: 1,
        label: 'assistant',
        role: 'assistant',
        turn: 1,
        preview: 'Answer',
      },
      {
        id: 'row-3',
        depth: 0,
        label: 'user',
        role: 'user',
        turn: 2,
        preview: 'Second prompt',
        contentText: 'Second prompt with hidden full text',
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      value: 'row-1',
      label: 'First prompt',
      description: 'Message 1 of 2',
    });
    expect(items[1]?.searchText).toContain('hidden full text');
  });
});
