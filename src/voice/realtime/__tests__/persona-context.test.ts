import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import {
  buildVoicePersonaBlock,
  buildVoicePersonaContext,
  VOICE_PERSONA_MAX_CHARS,
} from '../persona-context.js';

function config(coderInstructions = 'Prefer exact, practical answers.'): Config {
  return ConfigSchema.parse({
    agents: {
      default: 'main',
      list: [
        { id: 'main', profile: { name: 'Main' } },
        { id: 'coder', profile: { name: 'Code Voice', instructions: coderInstructions } },
      ],
    },
  });
}

describe('Omni voice persona context', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-voice-persona-'));
    process.env.XOPC_STATE_DIR = stateDir;
    for (const id of ['main', 'coder']) mkdirSync(join(stateDir, 'agents', id, 'profile'), { recursive: true });
    writeFileSync(join(stateDir, 'agents', 'main', 'profile', 'IDENTITY.md'), '- **Name:** Main File');
    writeFileSync(join(stateDir, 'agents', 'main', 'profile', 'SOUL.md'), 'MAIN_ONLY_PERSONA');
    writeFileSync(join(stateDir, 'agents', 'coder', 'profile', 'IDENTITY.md'), '- **Name:** Coder File\n- **Language:** Chinese');
    writeFileSync(join(stateDir, 'agents', 'coder', 'profile', 'SOUL.md'), 'CODER_ONLY_PERSONA\nBe sharp and calm.');
  });

  afterEach(() => {
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('loads the selected session agent instead of the default agent', () => {
    const current = config();
    const snapshot = buildVoicePersonaContext({
      getConfig: () => current,
      sessionKey: 'agent:coder:webchat:default:direct:test',
    });
    expect(snapshot.block).toContain('Agent id: coder');
    expect(snapshot.block).toContain('Agent name: Code Voice');
    expect(snapshot.block).toContain('Prefer exact, practical answers.');
    expect(snapshot.block).toContain('CODER_ONLY_PERSONA');
    expect(snapshot.block).not.toContain('MAIN_ONLY_PERSONA');
  });

  it('keeps every persona source within the fixed live-voice budget', () => {
    const block = buildVoicePersonaBlock({
      agentId: 'coder',
      name: 'Code Voice',
      customInstructions: `CUSTOM_START ${'c'.repeat(4_000)}`,
      identityMarkdown: `IDENTITY_START ${'i'.repeat(4_000)}`,
      soulMarkdown: `SOUL_START ${'s'.repeat(8_000)}`,
    });
    expect(block.length).toBeLessThanOrEqual(VOICE_PERSONA_MAX_CHARS);
    expect(block).toContain('CUSTOM_START');
    expect(block).toContain('IDENTITY_START');
    expect(block).toContain('SOUL_START');
    expect(block).toContain('truncated for live voice');
  });

  it('invalidates the snapshot when agent instructions or profile files change', () => {
    let current = config();
    const snapshot = buildVoicePersonaContext({
      getConfig: () => current,
      sessionKey: 'agent:coder:webchat:default:direct:test',
    });
    expect(snapshot.isCurrent()).toBe(true);
    current = config('Speak with more warmth.');
    expect(snapshot.isCurrent()).toBe(false);

    current = config();
    const fileSnapshot = buildVoicePersonaContext({
      getConfig: () => current,
      sessionKey: 'agent:coder:webchat:default:direct:test',
    });
    writeFileSync(join(stateDir, 'agents', 'coder', 'profile', 'SOUL.md'), 'CODER_ONLY_PERSONA changed and longer');
    expect(fileSnapshot.isCurrent()).toBe(false);
  });
});
