import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Config } from '../../../config/schema.js';
import { ENV_VARS } from '../../../config/paths-state.js';
import type { GoalPostTurnDecision } from '../evaluate-turn.js';
import { appendGoalRun, listGoalRuns, resolveGoalRunsFilePath } from '../goal-run-store.js';

const sessionKey = 'agent:main:webchat:default:direct:test-goal-runs';

function minimalConfig(stateRoot: string): Config {
  return {
    agents: {
      default: 'main',
      list: [{ id: 'main', default: true }],
      defaults: {
        workspace: join(stateRoot, 'ws'),
        model: 'openai/gpt-4o-mini',
        maxTokens: 4096,
        temperature: 0.7,
        maxToolIterations: 10,
        maxRequestsPerTurn: 20,
        maxToolFailuresPerTurn: 3,
        thinkingDefault: 'medium',
        reasoningDefault: 'stream',
        verboseDefault: 'full',
        compaction: {
          enabled: false,
          mode: 'default',
          reserveTokens: 8000,
          triggerThreshold: 0.8,
          minMessagesBeforeCompact: 10,
          keepRecentMessages: 5,
          evictionWindow: 0.2,
          retentionWindow: 6,
        },
        pruning: {
          enabled: false,
          maxToolResultChars: 10000,
          headKeepRatio: 0.3,
          tailKeepRatio: 0.3,
        },
      },
    },
    bindings: [],
    session: {},
    channels: {},
    gateway: {},
    tools: {},
    cron: {},
    extensions: {},
    modelsDev: {},
    messages: {},
    update: {},
  } as Config;
}

let tmp = '';
let prevState: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'xopc-goal-runs-'));
  prevState = process.env[ENV_VARS.STATE_DIR];
  process.env[ENV_VARS.STATE_DIR] = tmp;
});

afterEach(() => {
  if (prevState === undefined) {
    delete process.env[ENV_VARS.STATE_DIR];
  } else {
    process.env[ENV_VARS.STATE_DIR] = prevState;
  }
});

describe('goal-run-store', () => {
  it('appendGoalRun creates file and listGoalRuns returns newest first', async () => {
    const cfg = minimalConfig(tmp);
    const d1: GoalPostTurnDecision = {
      newState: {
        goal: 'Ship widget',
        status: 'active',
        turnsUsed: 1,
        maxTurns: 20,
        createdAt: 1,
        lastTurnAt: 2,
        lastVerdict: 'continue',
        lastReason: 'keep going',
      },
      shouldContinue: true,
      continuationPrompt: 'x',
      verdict: 'continue',
      reason: 'keep going',
      message: '',
    };
    await appendGoalRun({
      config: cfg,
      sessionKey,
      decision: d1,
      assistantPlainText: 'first reply',
    });

    const d2: GoalPostTurnDecision = {
      newState: {
        goal: 'Ship widget',
        status: 'done',
        turnsUsed: 2,
        maxTurns: 20,
        createdAt: 1,
        lastTurnAt: 3,
        lastVerdict: 'done',
        checklist: [
          {
            text: 'a',
            status: 'completed',
            addedBy: 'judge',
            addedAt: 1,
          },
        ],
      },
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'done',
      reason: 'shipped',
      message: 'done',
    };
    await appendGoalRun({
      config: cfg,
      sessionKey,
      decision: d2,
      assistantPlainText: 'final',
    });

    const runs = await listGoalRuns(cfg, sessionKey, { limit: 10 });
    expect(runs).toHaveLength(2);
    expect(runs[0]!.verdict).toBe('done');
    expect(runs[0]!.turnsUsed).toBe(2);
    expect(runs[0]!.checklistProgress).toEqual({ done: 1, total: 1 });
    expect(runs[1]!.verdict).toBe('continue');
    expect(runs[1]!.assistantPreview).toContain('first reply');

    const fp = resolveGoalRunsFilePath(cfg, sessionKey);
    expect(fp.startsWith(join(tmp, 'agents', 'main', 'goal-runs'))).toBe(true);
    const raw = await readFile(fp, 'utf8');
    expect(raw).toContain(sessionKey);
  });
});
