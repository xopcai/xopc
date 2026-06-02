import { describe, it, expect } from 'vitest';

import {
  commandRowDisabled,
  commandRowWillQueue,
} from '@/features/chat/palette/use-command-palette';
import type { PaletteItem } from '@/features/chat/palette/command-palette.types';

const skill: PaletteItem = { kind: 'skill', id: 'skill:docx', name: 'docx', description: '' };
const cmdNoArgs: PaletteItem = {
  kind: 'command',
  id: 'cmd:new',
  name: 'new',
  description: '',
  acceptsArgs: false,
};
const cmdWithArgs: PaletteItem = {
  kind: 'command',
  id: 'cmd:reply',
  name: 'reply',
  description: '',
  acceptsArgs: true,
};
const cmdAbort: PaletteItem = {
  kind: 'command',
  id: 'cmd:abort',
  name: 'abort',
  description: '',
  aliases: ['stop', 'cancel'],
  acceptsArgs: false,
};
const agent: PaletteItem = { kind: 'agent', id: 'agent:x', name: 'x', description: '' };

const idle = { runBusy: false, pendingFollowUpsCount: 0, maxPendingFollowUps: 10 };
const streaming = { runBusy: true, pendingFollowUpsCount: 0, maxPendingFollowUps: 10 };
const streamingFull = { runBusy: true, pendingFollowUpsCount: 10, maxPendingFollowUps: 10 };
const queueOnly = { runBusy: false, pendingFollowUpsCount: 3, maxPendingFollowUps: 10 };

describe('commandRowDisabled', () => {
  it('idle: nothing is disabled', () => {
    expect(commandRowDisabled(skill, idle)).toBe(false);
    expect(commandRowDisabled(cmdNoArgs, idle)).toBe(false);
    expect(commandRowDisabled(cmdWithArgs, idle)).toBe(false);
    expect(commandRowDisabled(cmdAbort, idle)).toBe(false);
    expect(commandRowDisabled(agent, idle)).toBe(false);
  });

  it('streaming, queue not full: only stays enabled (will queue, not disabled)', () => {
    expect(commandRowDisabled(cmdNoArgs, streaming)).toBe(false);
    expect(commandRowDisabled(cmdWithArgs, streaming)).toBe(false);
    expect(commandRowDisabled(cmdAbort, streaming)).toBe(false);
    expect(commandRowDisabled(agent, streaming)).toBe(false);
  });

  it('streaming + queue full: only args=false non-abort commands are disabled', () => {
    expect(commandRowDisabled(cmdNoArgs, streamingFull)).toBe(true);
    // args=true commands just insert text — never disabled.
    expect(commandRowDisabled(cmdWithArgs, streamingFull)).toBe(false);
    // abort routes through onAbort, not the queue — never disabled.
    expect(commandRowDisabled(cmdAbort, streamingFull)).toBe(false);
    // Skills / agents are unaffected by the queue.
    expect(commandRowDisabled(skill, streamingFull)).toBe(false);
    expect(commandRowDisabled(agent, streamingFull)).toBe(false);
  });

  it('idle but queue non-empty: still treated as stream-like (steerKbdBusy parity)', () => {
    // Not full → still actionable (will queue), not disabled.
    expect(commandRowDisabled(cmdNoArgs, queueOnly)).toBe(false);
    // Full would disable it; the helper handles either runBusy or queue alone.
    expect(commandRowDisabled(cmdNoArgs, { ...queueOnly, pendingFollowUpsCount: 10 })).toBe(true);
  });
});

describe('commandRowWillQueue', () => {
  it('only true for args=false non-abort commands in stream-like + queue-not-full state', () => {
    expect(commandRowWillQueue(cmdNoArgs, streaming)).toBe(true);
    expect(commandRowWillQueue(cmdNoArgs, queueOnly)).toBe(true);
    // queue full → not "will queue" (it's disabled instead)
    expect(commandRowWillQueue(cmdNoArgs, streamingFull)).toBe(false);
    // idle → no badge
    expect(commandRowWillQueue(cmdNoArgs, idle)).toBe(false);
    // not a command, no badge
    expect(commandRowWillQueue(skill, streaming)).toBe(false);
    expect(commandRowWillQueue(agent, streaming)).toBe(false);
    // args=true command, no badge
    expect(commandRowWillQueue(cmdWithArgs, streaming)).toBe(false);
    // abort, no badge (it fires onAbort instead of queueing)
    expect(commandRowWillQueue(cmdAbort, streaming)).toBe(false);
  });
});
