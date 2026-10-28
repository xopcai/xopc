import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillManager } from '../../skills/skill-manager.js';
import { createSkillConfigManager } from '../../skills/config.js';
import { createSkillManageTool } from '../skill-manage-tool.js';
import { createSkillInstallTool } from '../skill-install-tool.js';
import { openXopcDatabase, closeXopcDatabase } from '../../../storage/sqlite/connection.js';

const roots: string[] = [];
afterEach(() => { closeXopcDatabase(); vi.unstubAllEnvs(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

function setup(allowlist = ['report']) {
  const root = mkdtempSync(join(tmpdir(), 'xopc-skill-config-')); roots.push(root);
  vi.stubEnv('XOPC_STATE_DIR', root);
  const dir = join(root, '.xopc/skills/report'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: report\ndescription: Summarize a report\n---\nRead the report.');
  const manager = new SkillManager(root, join(root, 'bundled'));
  const tool = createSkillManageTool({ getSkillManager: () => manager, getWorkspace: () => root,
    getSkillIndexingContext: () => ({ registeredToolNames: ['skill_view'], skillAllowlist: allowlist }),
    onSkillsFilesystemMutate: () => manager.reload() });
  const call = async (action: string, name?: string) => {
    const result = await tool.execute('call', { action, name } as any);
    return JSON.parse((result.content[0] as { text: string }).text);
  };
  return { root, manager, call };
}

describe('conversational Skill configuration', () => {
  it('finds a disabled installation and enables it without reinstalling or exposing credentials', async () => {
    const { root, call } = setup();
    createSkillConfigManager(root).updateSkillConfig('report', { enabled: false, apiKey: 'private-test-value' });
    const before = await call('status', 'report');
    expect(before.skills[0]).toMatchObject({ state: 'disabled', availableToCurrentAgent: false, verified: false });
    expect(JSON.stringify(before)).not.toContain('private-test-value');
    const enabled = await call('enable', 'report');
    expect(enabled.skills[0]).toMatchObject({ state: 'ready', availableToCurrentAgent: true, verified: false });
    expect((await call('disable', 'report')).skills[0].state).toBe('disabled');
  });

  it('removes a managed skill, but refuses an extra-directory skill', async () => {
    const { root, call, manager } = setup();
    const skill = manager.findSkill('report')!;
    skill.origin = { ...skill.origin!, managed: false, writable: false, scope: 'extra' };
    expect((await call('delete', 'report')).success).toBe(false);
    manager.reload();
    expect((await call('delete', 'report')).success).toBe(true);
    expect((await call('status', 'report')).errorCode).toBe('skill_not_found');
    expect(createSkillConfigManager(root).load().entries?.report).toBeUndefined();
  });

  it('does not mistake Agent gating or a missing environment variable for successful readiness', async () => {
    const { manager, call } = setup([]);
    expect((await call('status', 'report')).skills[0]).toMatchObject({ state: 'agent_unavailable', availableToCurrentAgent: false });
    manager.findSkill('report')!.metadata.requires = { env: ['XOPC_CONFIG_TEST_ABSENT'] };
    expect((await call('status', 'report')).skills[0]).toMatchObject({ state: 'requirements_unmet', availableToCurrentAgent: false, missingEnv: ['XOPC_CONFIG_TEST_ABSENT'] });
  });

  it('replays a durable install receipt and rejects reuse for a different intent', async () => {
    const { root } = setup(); openXopcDatabase({ path: join(root, 'xopc.db') });
    const installSkillFromSource = vi.fn(async () => ({ skillId: 'report', path: root, source: 'fixture.zip', kind: 'archive' as const, contentHash: 'abc' }));
    const deps = { installSkillFromSource, getConversationId: () => 'conversation-a' };
    const first = createSkillInstallTool(deps);
    const input = { source: 'fixture.zip', idempotencyKey: 'install-report' };
    const original = await first.execute('call-a', input);
    closeXopcDatabase(); openXopcDatabase({ path: join(root, 'xopc.db') });
    expect(await createSkillInstallTool(deps).execute('call-b', input)).toEqual(original);
    expect(await createSkillInstallTool(deps).execute('call-defaults', { ...input, target: 'global', force: false, strictScan: false })).toEqual(original);
    const conflict = await first.execute('call-c', { ...input, source: 'other.zip' });
    expect(conflict.details).toMatchObject({ errorCode: 'intent_conflict' });
    expect(installSkillFromSource).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an installation whose outcome is still unknown after reopening storage', async () => {
    const { root } = setup(); openXopcDatabase({ path: join(root, 'xopc.db') });
    let complete!: (value: any) => void;
    const installSkillFromSource = vi.fn(() => new Promise<any>(resolve => { complete = resolve; }));
    const deps = { installSkillFromSource, getConversationId: () => 'conversation-a' };
    const input = { source: 'fixture.zip', idempotencyKey: 'interrupted-install' };
    const pending = createSkillInstallTool(deps).execute('call-a', input);
    closeXopcDatabase(); openXopcDatabase({ path: join(root, 'xopc.db') });
    const result = await createSkillInstallTool(deps).execute('call-b', input);
    expect(result.details).toMatchObject({ errorCode: 'install_unknown' });
    expect(installSkillFromSource).toHaveBeenCalledTimes(1);
    complete({ skillId: 'report', path: root, source: 'fixture.zip', kind: 'archive', contentHash: 'abc' });
    await pending;
  });
});
