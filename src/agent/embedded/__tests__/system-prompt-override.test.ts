import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { getCurrentSystemPrompt } from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

import { applySystemPromptOverrideToSession } from '../system-prompt-override.js';

describe('applySystemPromptOverrideToSession', () => {
  it('preserves the override when the actual SDK rebuilds tools and reuses the session', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'xopc-pi-prompt-'));
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
    try {
      const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
      const resourceLoader = new DefaultResourceLoader({
        cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true,
        noPromptTemplates: true, noThemes: true, noContextFiles: true,
      });
      await resourceLoader.reload();
      ({ session } = await createAgentSession({
        cwd, agentDir: cwd, model: getModel('openai', 'gpt-6-sol'),
        settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(), tools: ['read'],
      }));
      applySystemPromptOverrideToSession(session, 'xopc first turn');
      for (const tools of [[], ['read']]) {
        session.setActiveToolsByName(tools);
        expect(getCurrentSystemPrompt(session.agent.state.messages)).toBe('xopc first turn');
      }
      applySystemPromptOverrideToSession(session, 'xopc reused turn');
      session.setActiveToolsByName([]);
      expect(getCurrentSystemPrompt(session.agent.state.messages)).toBe('xopc reused turn');
    } finally {
      session?.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('locks system prompt and rebuild hook', () => {
    const session = {
      agent: { state: { messages: [], tools: [] } },
      _baseSystemPromptOptions: {},
      _rebuildSystemPrompt() {
        this._baseSystemPromptOptions = {};
      },
    } as Parameters<typeof applySystemPromptOverrideToSession>[0];

    applySystemPromptOverrideToSession(session, 'xopc-owned prompt');

    expect(getCurrentSystemPrompt(session.agent.state.messages)).toBe('xopc-owned prompt');
    const mutable = session as unknown as {
      _baseSystemPromptOptions?: { forceSystemPrompt?: string };
      _rebuildSystemPrompt?: (toolNames: string[]) => void;
    };
    expect(mutable._baseSystemPromptOptions?.forceSystemPrompt).toBe('xopc-owned prompt');
    mutable._rebuildSystemPrompt?.([]);
    expect(mutable._baseSystemPromptOptions?.forceSystemPrompt).toBe('xopc-owned prompt');
  });
});
