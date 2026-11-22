import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProductDeliveryText } from '@xopcai/gateway-contract';

import { ConfigSchema, type Config } from '../../config/schema.js';
import { createXopcUseTool } from '../../agent/tools/xopc-use-tool.js';
import { createPersonalSelfConfigTool } from '../../agent/tools/personal-self-config-tool.js';
import {
  buildSetupRecoveryHint,
  inspectSelfConfig,
  SelfConfigService,
  UnifiedSetupSceneService,
} from '../index.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('self-configuration engine (pillars 1-5)', () => {
  let tempDir: string;
  let prevStateDir: string | undefined;
  let config: Config;
  let events: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xopc-self-config-'));
    prevStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = join(tempDir, 'state');
    config = ConfigSchema.parse({
      channels: {
        telegram: { enabled: true, botToken: '123456:SUPER_SECRET_TOKEN', dmPolicy: 'pairing' },
      },
      tools: {
        web: {
          region: 'global',
          search: {
            maxResults: 5,
            providers: [{ type: 'tavily', apiKey: 'tvly-super-secret' }],
          },
        },
      },
    });
    events = [];
  });

  afterEach(() => {
    if (prevStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = prevStateDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createServices() {
    const saveConfig = vi.fn(async (next: Config) => {
      config = structuredClone(next);
      return { saved: true };
    });
    const saveProviderApiKey = vi.fn(async () => {});
    const emitEvent = (event: string, payload: unknown) => {
      events.push({ event, payload });
    };
    const selfConfig = new SelfConfigService({
      getConfig: () => config,
      saveConfig,
      getWorkspace: () => tempDir,
      emitEvent,
    });
    const setupScenes = new UnifiedSetupSceneService({
      getConfig: () => config,
      saveConfig,
      saveProviderApiKey,
      emitEvent,
    });
    return { selfConfig, setupScenes, saveConfig, saveProviderApiKey };
  }

  it('inspects all domains while strictly redacting all secrets and tokens', async () => {
    const res = await inspectSelfConfig(config);
    expect(res.ok).toBe(true);
    expect(res.domains.length).toBeGreaterThanOrEqual(8);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('SUPER_SECRET_TOKEN');
    expect(serialized).not.toContain('tvly-super-secret');

    const channels = res.domains.find((d) => d.domain === 'channels');
    expect(channels?.details).toMatchObject({
      telegram: { enabled: true, hasCredential: true, dmPolicy: 'pairing' },
    });
    const search = res.domains.find((d) => d.domain === 'web_search');
    expect(search?.configured).toBe(true);
  });

  it('enforces risk tiers: Tier 1 immediate + rollback, Tier 2 confirmation gate, Tier 3 secret block', async () => {
    const { selfConfig } = createServices();

    // Tier 1: immediate apply + rollback
    const tier1 = await selfConfig.patch({
      target: 'appearance.activity_detail',
      patch: { activityDetailDefault: 'stream' },
      conversationId: 'conv-1',
    });
    expect(tier1.ok).toBe(true);
    expect(tier1.tier).toBe(1);
    expect(config.gateway.webchat.activityDetailDefault).toBe('stream');
    expect(tier1.receipt?.canRollback).toBe(true);

    const rolled = await selfConfig.rollback(tier1.receipt!.changeId);
    expect(rolled.ok).toBe(true);
    expect(config.gateway.webchat.activityDetailDefault).toBe('on');

    // Tier 2: requires explicit confirm
    const tier2Blocked = await selfConfig.patch({
      target: 'computer',
      patch: { enabled: true },
    });
    expect(tier2Blocked.ok).toBe(false);
    expect(tier2Blocked.requiresConfirmation).toBe(true);
    expect(config.computer.enabled).toBe(false);

    const tier2Confirmed = await selfConfig.patch({
      target: 'computer',
      patch: { enabled: true },
      confirm: true,
    });
    expect(tier2Confirmed.ok).toBe(true);
    expect(tier2Confirmed.tier).toBe(2);
    expect(config.computer.enabled).toBe(true);

    // Tier 3: rejects secret keys and points to guided setup
    const tier3 = await selfConfig.patch({
      target: 'web_search',
      patch: { apiKey: 'tvly-leaked' },
      confirm: true,
    });
    expect(tier3.ok).toBe(false);
    expect(tier3.tier).toBe(3);
    expect(tier3.requiresInteraction).toBe(true);
    expect(tier3.setupScene).toBe('web_search');
  });

  it('sets, verifies, deletes, and rolls back the user avatar from a workspace image file', async () => {
    const { selfConfig } = createServices();
    const imgPath = join(tempDir, 'my-cat.png');
    writeFileSync(imgPath, TINY_PNG);

    const setRes = await selfConfig.setAvatar(
      { target: 'user', source: 'my-cat.png' },
      { conversationId: 'conv-1' },
    );
    expect(setRes.ok).toBe(true);
    expect(setRes.receipt?.target).toBe('user.avatar');
    expect(events.some((e) => e.event === 'user.avatar.updated')).toBe(true);

    const inspected = await selfConfig.inspect('profile');
    expect(inspected.domains[0]?.details).toMatchObject({
      userAvatar: { configured: true, contentType: 'image/png' },
    });

    // Rollback removes newly added avatar
    const rolled = await selfConfig.rollback(setRes.receipt!.changeId);
    expect(rolled.ok).toBe(true);
    const afterRollback = await selfConfig.inspect('profile');
    expect(afterRollback.domains[0]?.details).toMatchObject({
      userAvatar: { configured: false, contentType: null },
    });
  });

  it('drives unified setup scenes with resumeObjective and secure Tier-3 input submission', async () => {
    const { setupScenes, saveProviderApiKey } = createServices();
    const started = await setupScenes.command(
      'models',
      'start',
      { resumeObjective: 'Generate a cute cat avatar for me', capability: 'image-generation' },
      { conversationId: 'conv-setup', agentId: 'main', canConfigure: true },
    );
    const setup = started.setup as { id: string; interactionPath: string; resumeObjective?: string };
    expect(setup.interactionPath).toContain('/configuration/models/');
    expect(setup.resumeObjective).toBe('Generate a cute cat avatar for me');

    const submitted = await setupScenes.submitSecureInput(
      'models',
      setup.id,
      'conv-setup',
      { providerId: 'openai', apiKey: 'sk-test-1234' },
    );
    expect(saveProviderApiKey).toHaveBeenCalledWith('openai', 'sk-test-1234');
    expect(submitted.revision).toBeGreaterThan(1);

    // Computer scene end-to-end enable + verify
    const compStart = await setupScenes.command(
      'computer',
      'start',
      { resumeObjective: 'Open Notes app' },
      { conversationId: 'conv-comp', agentId: 'main', canConfigure: true },
    );
    const compId = (compStart.setup as { id: string }).id;
    await setupScenes.submitSecureInput('computer', compId, 'conv-comp', { enabled: true });
    expect(config.computer.enabled).toBe(true);
  });

  it('exposes settings inspect/patch/set_avatar/rollback and setup scenes through xopc_use and personal_self_config with config_change delivery', async () => {
    const { selfConfig, setupScenes } = createServices();
    const xopcUse = createXopcUseTool({
      getConfig: () => config,
      getCurrentAgentId: () => 'main',
      getCurrentConversationId: () => 'conv-tool',
      getSelfConfigService: () => selfConfig,
      getSetupSceneService: () => setupScenes,
      canConfigureFromConversation: () => true,
    });

    const inspectOut = await xopcUse.execute('c1', { mode: 'settings', command: 'inspect', args: { domain: 'voice' } }, AbortSignal.timeout(5000));
    expect(JSON.parse(inspectOut.content[0]!.type === 'text' ? inspectOut.content[0]!.text : '{}')).toMatchObject({
      ok: true,
      domain: 'voice',
    });

    const patchOut = await xopcUse.execute('c2', {
      mode: 'settings',
      command: 'patch',
      args: { target: 'voice.tts', patch: { trigger: 'tagged' } },
    }, AbortSignal.timeout(5000));
    const text = patchOut.content[0]!.type === 'text' ? patchOut.content[0]!.text : '';
    const delivery = parseProductDeliveryText(text);
    expect(delivery?.presentation).toMatchObject({
      kind: 'config_change',
      tier: 1,
      target: 'voice.tts',
      canRollback: true,
    });

    const personalTool = createPersonalSelfConfigTool({
      getSelfConfigService: () => selfConfig,
      getSetupSceneService: () => setupScenes,
      getCurrentConversationId: () => 'conv-personal',
      getCurrentAgentId: () => 'personal',
    });
    const personalInspect = await personalTool.execute('c3', { command: 'inspect', domain: 'profile' }, AbortSignal.timeout(5000));
    expect(personalInspect.details).toMatchObject({ ok: true, domain: 'profile' });

    const personalSetup = await personalTool.execute(
      'c4',
      { command: 'start_setup', scene: 'web_search', resumeObjective: 'Search today news' },
      AbortSignal.timeout(5000),
    );
    expect((personalSetup.details as { setup?: { interactionPath?: string } }).setup?.interactionPath).toContain('/configuration/web_search/');

    const hint = buildSetupRecoveryHint({ scene: 'voice', capability: 'tts', reason: 'TTS disabled' });
    expect(hint.kind).toBe('setup_required');
    expect(hint.nextAction).toContain('mode: "setup"');
  });
});
