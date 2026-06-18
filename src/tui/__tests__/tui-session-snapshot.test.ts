import { describe, expect, it } from 'vitest';

import { TuiSessionSnapshot } from '../tui-session-snapshot.js';

describe('TuiSessionSnapshot', () => {
  it('exposes a pi-style read-only session manager snapshot', () => {
    let sessionKey = 'agent:main:main';
    const snapshot = new TuiSessionSnapshot(
      () => sessionKey,
      () => '/tmp/work',
      () => 'Main session',
      () => `/tmp/xopc.db#session=${encodeURIComponent(sessionKey)}`,
      () => '/tmp/.xopc',
    );

    snapshot.replaceFromHistory([
      { id: 'row-1', role: 'user', content: 'hello', kind: 'message', timestamp: 1 },
      { id: 'row-2', role: 'assistant', content: 'hi', kind: 'message', timestamp: 2 },
      { id: 'row-3', role: 'assistant', content: 'summary', kind: 'compaction', timestamp: 3 },
      {
        id: 'row-4',
        role: 'system',
        content: 'hidden payload',
        kind: 'custom',
        custom: { customType: 'hidden', display: false },
      },
    ]);

    const manager = snapshot.manager();
    expect(manager.getSessionId()).toBe('agent:main:main');
    expect(manager.getSessionFile()).toBe('/tmp/xopc.db#session=agent%3Amain%3Amain');
    expect(manager.getSessionDir()).toBe('/tmp/.xopc');
    expect(manager.getSessionName()).toBe('Main session');
    expect(manager.getCwd()).toBe('/tmp/work');
    expect(manager.getEntries().map((entry) => entry.type)).toEqual([
      'message',
      'message',
      'compaction',
      'custom',
    ]);
    expect(manager.getEntries().map((entry) => entry.parentId)).toEqual([
      null,
      'row-1',
      'row-2',
      'row-3',
    ]);
    expect(manager.getBranch().map((entry) => entry.content)).toEqual([
      'hello',
      'hi',
      'summary',
      'hidden payload',
    ]);
    expect(manager.getEntry('row-2')?.content).toBe('hi');
    expect(manager.getEntry('missing')).toBeUndefined();
    expect(manager.getLeafEntry()?.content).toBe('hidden payload');
    expect(manager.getLeafEntry()?.display).toBe(false);
    expect(manager.getLeafId()).toBe('row-4');
    expect(manager.getHeader()).toEqual({
      type: 'session',
      version: 3,
      id: 'agent:main:main',
      timestamp: '1970-01-01T00:00:00.001Z',
      cwd: '/tmp/work',
    });
    expect(manager.getTree()).toMatchObject([
      {
        entry: { id: 'row-1', parentId: null, content: 'hello' },
        children: [
          {
            entry: { id: 'row-2', parentId: 'row-1', content: 'hi' },
            children: [
              {
                entry: { id: 'row-3', parentId: 'row-2', content: 'summary' },
                children: [
                  {
                    entry: { id: 'row-4', parentId: 'row-3', content: 'hidden payload' },
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(manager.getLabel('row-3')).toBeUndefined();

    snapshot.setLabel('row-3', 'handoff');
    expect(manager.getLabel('row-3')).toBe('handoff');
    expect(manager.getTree()[0]?.children[0]?.children[0]).toMatchObject({
      label: 'handoff',
    });
    snapshot.setLabel('row-3', undefined);
    expect(manager.getLabel('row-3')).toBeUndefined();

    snapshot.appendCustomEntry('preset-state', { name: 'fast' });
    expect(manager.getLeafEntry()).toMatchObject({
      id: 'tui:1',
      type: 'custom',
      customType: 'preset-state',
      data: { name: 'fast' },
    });

    snapshot.appendCustomMessage({
      customType: 'status-update',
      content: 'ready',
      details: { level: 'info' },
    });
    expect(manager.getLeafEntry()).toMatchObject({
      id: 'tui:2',
      type: 'custom',
      customType: 'status-update',
      data: { level: 'info' },
      content: 'ready',
    });

    const copy = manager.getEntries();
    copy.length = 0;
    expect(manager.getEntries()).toHaveLength(6);

    snapshot.appendMessage('user', 'next');
    expect(manager.getLeafEntry()).toMatchObject({
      id: 'tui:3',
      type: 'message',
      role: 'user',
      message: { role: 'user', content: 'next' },
    });

    sessionKey = 'agent:other:main';
    expect(manager.getSessionId()).toBe('agent:other:main');
    expect(manager.getSessionFile()).toBe('/tmp/xopc.db#session=agent%3Aother%3Amain');
  });
});
