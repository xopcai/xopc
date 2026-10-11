import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

it('keeps the host preamble when public pi APIs rebuild the active tool loadout', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'xopc-pi-prompt-'));
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  try {
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({
      cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true,
      noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'xopc first turn',
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({
      cwd, agentDir: cwd, model: getModel('openai', 'gpt-6-sol'),
      settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(), tools: ['read'],
    }));
    for (const tools of [[], ['read']]) {
      session.setActiveToolsByName(tools);
      const prompt = session.systemPrompt;
      expect(prompt).toContain('xopc first turn');
      expect(prompt).toContain('<cwd>');
      expect(prompt).not.toContain('expert coding assistant operating inside pi');
    }
  } finally { session?.dispose(); await rm(cwd, { recursive: true, force: true }); }
});
