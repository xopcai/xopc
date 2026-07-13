import { describe, expect, it } from 'vitest';

import { actionForEvent, messageForEvent } from '@/features/desktop-pet/desktop-pet-copy';
import { activityForProgress, activityForTool } from '@/features/desktop-pet/desktop-pet-activity';
import { mapAgentStreamEvent } from '@/features/desktop-pet/desktop-pet-event-bridge';
import { messages } from '@/i18n/messages';

describe('desktop pet execution copy', () => {
  const zh = messages('zh').desktopPet;

  it('turns a file operation into a concrete action', () => {
    const event = { kind: 'agent-tool' as const, toolName: 'apply_patch' };

    expect(actionForEvent(event)).toBe('file');
    expect(messageForEvent(event, 'zh', zh)).toBe('我正在编辑文件。');
  });

  it('turns a command into a terminal action', () => {
    const event = { kind: 'agent-tool' as const, toolName: 'exec_command' };

    expect(actionForEvent(event)).toBe('terminal');
    expect(messageForEvent(event, 'zh', zh)).toBe('我正在运行命令。');
  });

  it('does not use the generic acknowledgement for an agent start', () => {
    expect(messageForEvent({ kind: 'agent-start' }, 'zh', zh)).toBe('任务已接手，正在准备。');
  });

  it('keeps only a file basename from tool arguments', () => {
    expect(activityForTool('read_file', { path: 'D:/work/private/project/src/agent.ts' })).toEqual({
      phase: 'reading',
      detail: 'agent.ts',
    });
    expect(activityForTool('exec_command', { cmd: 'echo $API_KEY' })).toEqual({ phase: 'running' });
  });

  it('maps stream payloads into structured, display-safe activity', () => {
    expect(
      mapAgentStreamEvent({
        sessionKey: 'main:chat:1',
        event: {
          type: 'tool_start',
          payload: { toolName: 'read_file', args: { path: '/workspace/src/pet.ts' } },
        },
      }),
    ).toMatchObject({
      kind: 'agent-tool',
      activity: { phase: 'reading', detail: 'pet.ts' },
    });
    expect(activityForProgress({ stage: 'verification', completed: 2, total: 3 })).toEqual({
      phase: 'running',
      completed: 2,
      total: 3,
    });
    expect(
      mapAgentStreamEvent({ sessionKey: 'main:chat:1', event: { type: 'compaction', payload: {} } }),
    ).toMatchObject({ activity: { phase: 'compacting' } });
    expect(
      mapAgentStreamEvent({
        sessionKey: 'main:chat:1',
        event: { type: 'clarify_request', runId: 'run-1', payload: { question: 'Continue?' } },
      }),
    ).toMatchObject({
      kind: 'agent-progress',
      severity: 'warning',
      runId: 'run-1',
      activity: { phase: 'waiting' },
    });
    expect(
      mapAgentStreamEvent({
        sessionKey: 'main:chat:1',
        event: { type: 'error', payload: { message: 'command failed: token=secret' } },
      }),
    ).toEqual({
      kind: 'agent-error',
      severity: 'error',
      sessionKey: 'main:chat:1',
      route: '/chat/main:chat:1',
    });
  });
});
