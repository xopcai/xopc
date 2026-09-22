/** Real authenticated Gateway smoke with disposable state; never touches the user's database. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineTaskContract } from '../src/tasks/task-contract-definition.js';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');
let socket: import('ws').WebSocket | undefined;

const directory = mkdtempSync(join(tmpdir(), 'xopc-capabilities-smoke-'));
const workspace = join(directory, 'workspace');
mkdirSync(workspace);
const grantFixtureRoot = join(directory, 'extensions', 'grant-smoke');
mkdirSync(join(grantFixtureRoot, 'ui'), { recursive: true });
writeFileSync(join(grantFixtureRoot, 'index.js'), 'export default Object.freeze({});\n');
writeFileSync(join(grantFixtureRoot, 'ui', 'index.html'), '<!doctype html><title>Grant fixture</title>');
writeFileSync(join(grantFixtureRoot, 'xopc.extension.json'), JSON.stringify({ id: 'grant-smoke', name: 'Grant fixture',
  version: '1.0.0', kind: 'utility', main: 'index.js', engines: { xopc: '>=0.0.0' }, ui: { main: 'ui/index.html', permissions: ['theme'] } }));
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
const token = 'isolated-capability-smoke';
const config = join(directory, 'xopc.json');
writeFileSync(config, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token }, scenes: { enabled: true } }, browser: { enabled: false } }));
const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
  env: { ...process.env, XOPC_STATE_DIR: directory, XOPC_WORKSPACE: workspace, XOPC_CONFIG_PATH: config, XOPC_CONFIG: config,
    XOPC_HOME: directory, XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_LEVEL: 'fatal' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout!.on('data', data => { output = (output + data).slice(-8000); });
child.stderr!.on('data', data => { output = (output + data).slice(-8000); });
async function request(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
  return fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { ready = (await (await fetch(`${origin}/api/health`)).json()).ready === true; } catch {}
    if (ready || child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(ready, `Gateway not ready: ${output}`);
  const root = '/api/capabilities/operations';
  assert.equal((await fetch(`${origin}${root}`)).status, 401);
  const catalog = await request(root);
  assert.equal(catalog.status, 200);
  const { capabilities } = await catalog.json();
  assert.equal(capabilities.length, 94);
  const localCapabilities = '/api/local-app-capabilities/grant-smoke';
  assert.equal((await fetch(`${origin}${localCapabilities}`)).status, 401);
  assert.equal((await request(localCapabilities)).status, 400);
  assert.equal((await request(`${localCapabilities}?manifestDigest=${'a'.repeat(64)}`)).status, 403);
  assert.equal((await request(`${localCapabilities}/xopc.notes.list/invocations`, 'POST', {
    manifestDigest: 'a'.repeat(64), call: { majorVersion: 1, descriptorDigest: 'a'.repeat(64), input: {} },
  })).status, 403);
  const grantPath = '/api/extensions/grant-smoke/ui-grant';
  const grantResponse = await request(grantPath);
  assert.equal(grantResponse.status, 200, await grantResponse.clone().text());
  const { grant } = await grantResponse.json();
  assert.equal(grant.granted, false);
  assert.equal((await request(grantPath, 'POST', {})).status, 400);
  assert.equal((await request(grantPath, 'POST', { manifestDigest: '0'.repeat(64) })).status, 409);
  const confirmedGrant = await request(grantPath, 'POST', { manifestDigest: grant.manifestDigest });
  assert.equal(confirmedGrant.status, 200, await confirmedGrant.clone().text());
  assert.equal((await confirmedGrant.json()).grant.granted, true);
  const mcp = new Client({ name: 'isolated-smoke', version: '1' });
  const mcpTransport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'tsx', 'src/cli/bin.ts', '--config', config, 'mcp', 'capabilities', '--allow-capability', 'xopc.notes.list', 'xopc.notes.create'],
    env: { PATH: process.env.PATH ?? '', XOPC_STATE_DIR: directory, XOPC_WORKSPACE: workspace, XOPC_CONFIG_PATH: config,
      XOPC_CONFIG: config, XOPC_HOME: directory, XOPC_NO_RESPAWN: '1', XOPC_LOG_FILE: 'false' }, stderr: 'pipe' });
  try {
    await mcp.connect(mcpTransport);
    const tools = (await mcp.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['xopc.notes.create', 'xopc.notes.list']);
    const descriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.notes.create');
    const call = { name: descriptor.id, arguments: { majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest,
      idempotencyKey: 'mcp-local-note', input: { title: 'MCP fixture', markdown: 'Local isolated data' } } };
    const first = await mcp.callTool(call);
    assert.notEqual(first.isError, true);
    assert.deepEqual((await mcp.callTool(call)).structuredContent, first.structuredContent);
    assert.equal((await mcp.callTool({ name: 'xopc.notes.delete', arguments: {} })).isError, true);
  } finally { await mcp.close(); await mcpTransport.close(); }
  async function resolvePage(kind: string, id: string, revision: string) {
    const descriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.context.resolve');
    const response = await request(`${root}/xopc.context.resolve/invocations`, 'POST', {
      majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest,
      input: { version: 1, clientInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tabId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sequence: 1, surface: 'web', capturedAt: Date.now(),
        resourceRefs: [{ kind, id, revision }] },
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).data.resources[0];
  }
  const sceneTemplates = await request('/api/scenes/templates');
  assert.equal(sceneTemplates.status, 200, await sceneTemplates.clone().text());
  const templates = (await sceneTemplates.json()).templates;
  assert.ok(templates.length > 0);
  const sceneDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.scenes.templates');
  const sceneRead = await request(`${root}/xopc.scenes.templates/invocations`, 'POST', {
    input: {}, majorVersion: sceneDescriptor.majorVersion, descriptorDigest: sceneDescriptor.descriptorDigest,
  });
  assert.equal(sceneRead.status, 200, await sceneRead.clone().text());
  assert.deepEqual((await sceneRead.json()).data.templates, templates);
  assert.equal((await request('/api/scenes/activations?ownerId=other')).status, 400);
  const scenePreferencesInput = { expectedRevision: 0, level: 'quiet', timezone: 'UTC', digestEnabled: true };
  const scenePreferencesWrite = await request('/api/scenes/preferences', 'PATCH', scenePreferencesInput, { 'idempotency-key': 'scene-preferences' });
  assert.equal(scenePreferencesWrite.status, 200, await scenePreferencesWrite.clone().text());
  const scenePreferencesResult = await scenePreferencesWrite.json();
  const scenePreferencesDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.scenes.set_preferences');
  const scenePreferencesReplay = await request(`${root}/xopc.scenes.set_preferences/invocations`, 'POST', {
    input: scenePreferencesInput, idempotencyKey: 'scene-preferences', majorVersion: scenePreferencesDescriptor.majorVersion,
    descriptorDigest: scenePreferencesDescriptor.descriptorDigest,
  });
  assert.equal(scenePreferencesReplay.status, 200, await scenePreferencesReplay.clone().text());
  assert.deepEqual((await scenePreferencesReplay.json()).data, scenePreferencesResult);
  const scenePreferencesPatch = await request('/api/scenes/preferences', 'PATCH', { expectedRevision: 1, notificationsMuted: true });
  assert.equal(scenePreferencesPatch.status, 200, await scenePreferencesPatch.clone().text());
  const scenePreferencesCurrent = await scenePreferencesPatch.json();
  assert.equal(scenePreferencesCurrent.level, 'quiet');
  assert.equal(scenePreferencesCurrent.timezone, 'UTC');
  assert.equal(scenePreferencesCurrent.digestEnabled, true);
  assert.equal((await request('/api/scenes/preferences', 'PATCH', scenePreferencesInput, { 'idempotency-key': 'scene-preferences-stale' })).status, 409);
  const settingsDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.settings.open');
  const settingsResult = await request(`${root}/xopc.settings.open/invocations`, 'POST', {
    input: { section: 'capabilities/models' }, majorVersion: settingsDescriptor.majorVersion, descriptorDigest: settingsDescriptor.descriptorDigest,
  });
  assert.equal(settingsResult.status, 200, await settingsResult.clone().text());
  assert.equal((await settingsResult.json()).data.settings.section, 'capabilities/models');
  const localAppsResponse = await request('/api/local-apps');
  assert.equal(localAppsResponse.status, 200, await localAppsResponse.clone().text());
  assert.deepEqual(await localAppsResponse.json(), { apps: [] });
  assert.equal((await request('/api/local-apps/missing')).status, 404);
  assert.equal((await request('/api/local-apps/missing/validate', 'POST')).status, 404);
  const localAppCreated = await request('/api/local-apps', 'POST', { name: 'Acceptance smoke', idea: 'Local-only test fixture' });
  assert.equal(localAppCreated.status, 201, await localAppCreated.clone().text());
  const localApp = (await localAppCreated.json()).app;
  const localValidation = await request(`/api/local-apps/${localApp.id}/validate`, 'POST');
  assert.equal(localValidation.status, 200, await localValidation.clone().text());
  const acceptanceInput = { sourceHash: (await localValidation.json()).validation.sourceHash, status: 'failed', interactiveCount: 0,
    checks: ['document', 'content', 'interaction', 'criteria'].map(id => ({ id, status: 'failed', message: 'Smoke fixture does not claim browser acceptance' })),
  };
  assert.equal((await resolvePage('local_app', localApp.id, acceptanceInput.sourceHash)).text, 'Local-only test fixture');
  const acceptanceResponse = await request(`/api/local-apps/${localApp.id}/acceptance-runs`, 'POST', acceptanceInput, { 'idempotency-key': 'local-acceptance' });
  assert.equal(acceptanceResponse.status, 201, await acceptanceResponse.clone().text());
  const acceptanceDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.local_apps.record_acceptance');
  const acceptanceReplay = await request(`${root}/xopc.local_apps.record_acceptance/invocations`, 'POST', {
    input: { ...acceptanceInput, id: localApp.id }, majorVersion: acceptanceDescriptor.majorVersion,
    descriptorDigest: acceptanceDescriptor.descriptorDigest, idempotencyKey: 'local-acceptance',
  });
  assert.equal(acceptanceReplay.status, 200, await acceptanceReplay.clone().text());
  assert.deepEqual((await acceptanceReplay.json()).data, await acceptanceResponse.json());
  const automationInput = {
    name: 'Isolated manual fixture', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Never executed in this test' },
    conversationMode: 'continuous', notificationPolicy: 'none',
  };
  const automationResponse = await request('/api/automations', 'POST', automationInput, { 'idempotency-key': 'automation-create' });
  const simulation = await request('/api/automations/simulate', 'POST', automationInput);
  assert.equal(simulation.status, 200, await simulation.clone().text());
  const simulationDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.automations.simulate');
  const sharedSimulation = await request(`${root}/xopc.automations.simulate/invocations`, 'POST', {
    input: automationInput, majorVersion: simulationDescriptor.majorVersion, descriptorDigest: simulationDescriptor.descriptorDigest,
  });
  assert.equal(sharedSimulation.status, 200, await sharedSimulation.clone().text());
  assert.deepEqual((await sharedSimulation.json()).data, await simulation.json());
  assert.equal((await request('/api/automations/draft', 'POST', { prompt: '' })).status, 400);
  assert.equal((await request('/api/automation-runs/missing/repair-draft', 'POST', {})).status, 404);
  assert.equal(automationResponse.status, 201, await automationResponse.clone().text());
  const automation = (await automationResponse.json()).automation;
  const automationCreateDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.automations.create');
  const createReplay = await request(`${root}/xopc.automations.create/invocations`, 'POST', {
    majorVersion: automationCreateDescriptor.majorVersion, descriptorDigest: automationCreateDescriptor.descriptorDigest,
    input: automationInput, idempotencyKey: 'automation-create',
  });
  assert.equal(createReplay.status, 200, await createReplay.clone().text());
  assert.deepEqual((await createReplay.json()).data.automation, automation);
  const automationRead = await request(`/api/automations/${automation.id}`);
  assert.equal(automationRead.status, 200, await automationRead.clone().text());
  assert.deepEqual((await automationRead.json()).automation, automation);
  assert.equal((await request('/api/automations')).status, 200);
  assert.equal((await request(`/api/automation-runs?automationId=${automation.id}`)).status, 200);
  const projectResponse = await request('/api/projects', 'POST', { name: 'Capability project fixture' });
  assert.equal(projectResponse.status, 201, await projectResponse.clone().text());
  const project = (await projectResponse.json()).project;
  assert.equal((await resolvePage('project', project.id, String(project.version))).title, 'Capability project fixture');
  const resolveInput = { workspacePath: workspace, autoCreate: true, agentId: 'main', conversationId: 'a708f379-3523-4553-97d9-ed342b848c77' };
  const resolvedResponse = await request('/api/projects/resolve-workspace', 'POST', resolveInput, { 'idempotency-key': 'project-resolve' });
  assert.equal(resolvedResponse.status, 200, await resolvedResponse.clone().text());
  const resolved = await resolvedResponse.json();
  assert.equal(resolved.created, true);
  assert.equal(resolved.project.version, 2);
  const resolveDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.projects.resolve_workspace');
  const resolveReplay = await request(`${root}/xopc.projects.resolve_workspace/invocations`, 'POST', {
    input: resolveInput, idempotencyKey: 'project-resolve', majorVersion: resolveDescriptor.majorVersion, descriptorDigest: resolveDescriptor.descriptorDigest,
  });
  assert.equal(resolveReplay.status, 200, await resolveReplay.clone().text());
  assert.deepEqual((await resolveReplay.json()).data, resolved);
  const milestonePath = `/api/projects/${project.id}/milestones`;
  const milestoneInput = { title: 'Ship safely' };
  const milestoneHeaders = { 'idempotency-key': 'milestone-create' };
  const milestoneResponse = await request(milestonePath, 'POST', milestoneInput, milestoneHeaders);
  assert.equal(milestoneResponse.status, 201, await milestoneResponse.clone().text());
  const milestone = (await milestoneResponse.json()).milestone;
  assert.deepEqual((await (await request(milestonePath, 'POST', milestoneInput, milestoneHeaders)).json()).milestone, milestone);
  const milestoneEdit = { title: 'Review safely', expectedRevision: milestone.updatedAt };
  const milestoneItemPath = `${milestonePath}/${milestone.id}`;
  const milestoneEditHeaders = { 'idempotency-key': 'milestone-edit' };
  const milestoneEditedResponse = await request(milestoneItemPath, 'PATCH', milestoneEdit, milestoneEditHeaders);
  assert.equal(milestoneEditedResponse.status, 200, await milestoneEditedResponse.clone().text());
  const editedMilestone = (await milestoneEditedResponse.json()).milestone;
  assert.deepEqual((await (await request(milestoneItemPath, 'PATCH', milestoneEdit, milestoneEditHeaders)).json()).milestone, editedMilestone);
  assert.equal((await request(milestoneItemPath, 'PATCH', milestoneEdit, { 'idempotency-key': 'stale-edit' })).status, 409);
  const deleteMilestoneHeaders = { 'idempotency-key': 'milestone-delete' };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await request(milestoneItemPath, 'DELETE', { expectedRevision: editedMilestone.updatedAt }, deleteMilestoneHeaders)).status, 200);
  }
  const progressPath = `/api/projects/${project.id}/updates`;
  const progressVersion = (await (await request(`/api/projects/${project.id}`)).json()).project.version;
  const progressInput = { summary: 'Ready for review', health: 'on_track', expectedVersion: progressVersion };
  const progressHeaders = { 'idempotency-key': 'project-progress' };
  const progressResponse = await request(progressPath, 'POST', progressInput, progressHeaders);
  assert.equal(progressResponse.status, 201, await progressResponse.clone().text());
  assert.deepEqual(await (await request(progressPath, 'POST', progressInput, progressHeaders)).json(), await progressResponse.json());
  assert.equal((await request(progressPath, 'POST', { ...progressInput, actor: { kind: 'system' } })).status, 400);
  const pausePath = `/api/automations/${automation.id}/pause`;
  const pauseInput = { expectedRevision: automation.updatedAtMs };
  const pauseHeaders = { 'idempotency-key': 'automation-pause' };
  const pausedResponse = await request(pausePath, 'POST', pauseInput, pauseHeaders);
  assert.equal(pausedResponse.status, 200, await pausedResponse.clone().text());
  const paused = (await pausedResponse.json()).automation;
  assert.equal(paused.enabled, false);
  const resumedResponse = await request(`/api/automations/${automation.id}/resume`, 'POST');
  assert.equal(resumedResponse.status, 200, await resumedResponse.clone().text());
  const resumed = (await resumedResponse.json()).automation;
  const pauseReplay = await request(pausePath, 'POST', pauseInput, pauseHeaders);
  assert.equal(pauseReplay.status, 200);
  assert.deepEqual((await pauseReplay.json()).automation, paused);
  assert.deepEqual((await (await request(`/api/automations/${automation.id}`)).json()).automation, resumed);
  assert.equal((await request(pausePath, 'POST', pauseInput, { 'idempotency-key': 'stale-pause' })).status, 409);
  assert.equal((await request(pausePath, 'POST', {}, pauseHeaders)).status, 400);
  assert.equal((await request(pausePath, 'POST', { expectedRevision: null })).status, 400);
  const editBody = { name: 'Edited fixture', expectedRevision: resumed.updatedAtMs };
  const editHeaders = { 'idempotency-key': 'automation-edit' };
  const editPath = `/api/automations/${automation.id}`;
  const editedResponse = await request(editPath, 'PATCH', editBody, editHeaders);
  assert.equal(editedResponse.status, 200, await editedResponse.clone().text());
  const editedAutomation = (await editedResponse.json()).automation;
  assert.equal(editedAutomation.name, 'Edited fixture');
  assert.deepEqual((await (await request(editPath, 'PATCH', editBody, editHeaders)).json()).automation, editedAutomation);
  assert.equal((await request(editPath, 'PATCH', editBody, { 'idempotency-key': 'stale-edit' })).status, 409);
  assert.equal((await request(editPath, 'PATCH', { name: 'Missing revision' }, editHeaders)).status, 400);
  assert.equal((await request(editPath, 'PATCH', { state: { runningRunId: 'forged' } })).status, 400);
  const deleteBody = { expectedRevision: editedAutomation.updatedAtMs };
  const deleteHeaders = { 'idempotency-key': 'automation-delete' };
  assert.equal((await request(editPath, 'DELETE', {}, deleteHeaders)).status, 400);
  const deletedAutomationResponse = await request(editPath, 'DELETE', deleteBody, deleteHeaders);
  assert.equal(deletedAutomationResponse.status, 200, await deletedAutomationResponse.clone().text());
  assert.deepEqual(await deletedAutomationResponse.json(), { removed: true });
  assert.equal((await request(editPath)).status, 404);
  const recreateResponse = await request('/api/automations', 'POST', { ...automationInput, id: automation.id });
  assert.equal(recreateResponse.status, 201, await recreateResponse.clone().text());
  const recreatedAutomation = (await recreateResponse.json()).automation;
  assert.ok(recreatedAutomation.updatedAtMs > editedAutomation.updatedAtMs);
  assert.deepEqual(await (await request(editPath, 'DELETE', deleteBody, deleteHeaders)).json(), { removed: true });
  assert.deepEqual((await (await request(editPath)).json()).automation, recreatedAutomation);
  assert.equal((await request(editPath, 'DELETE', deleteBody, { 'idempotency-key': 'stale-delete' })).status, 409);
  const runnableResponse = await request('/api/automations', 'POST', {
    name: 'Safe queue fixture', trigger: { kind: 'manual' }, action: { kind: 'workflow', workflowId: 'never-executed' },
    safety: { mode: 'suggest_only' }, notificationPolicy: 'none',
  });
  assert.equal(runnableResponse.status, 201, await runnableResponse.clone().text());
  const runnable = (await runnableResponse.json()).automation;
  const runPath = `/api/automations/${runnable.id}/run`;
  const runHeaders = { 'idempotency-key': 'manual-run' };
  const runResponse = await request(runPath, 'POST', undefined, runHeaders);
  assert.equal(runResponse.status, 200, await runResponse.clone().text());
  const acceptedRun = (await runResponse.json()).run;
  const waitForRun = async (runId: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const history = (await (await request(`/api/automation-runs?automationId=${runnable.id}`)).json()).runs;
      const run = history.find((item: { id: string }) => item.id === runId);
      if (run && !['queued', 'running', 'cancelling'].includes(run.status)) {
        assert.equal(run.status, 'succeeded');
        assert.match(run.summary, /Suggest only/);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('Safe queued run did not finish');
  };
  await waitForRun(acceptedRun.id);
  assert.equal((await (await request(`/api/automation-runs/${acceptedRun.id}`)).json()).run.status, 'succeeded');
  assert.ok((await (await request(`/api/automation-runs/${acceptedRun.id}/events`)).json()).events.some((event: { type: string }) => event.type === 'run.completed'));
  assert.equal((await request('/api/automation-runs/missing/events')).status, 404);
  assert.ok((await (await request('/api/automations/metrics')).json()).totalAutomations >= 1);
  assert.deepEqual(await (await request('/api/automation-runs/product-events?eventType=missing')).json(), { items: [] });
  assert.equal((await request('/api/automation-runs/product-events?eventType=missing&limit=1.5')).status, 400);
  assert.equal((await request('/api/automation-runs/product-events?eventType=missing&payloadKey=taskId')).status, 400);
  for (const [operation, input, path, field] of [
    ['get_run', { id: acceptedRun.id }, `/api/automation-runs/${acceptedRun.id}`, 'run'],
    ['run_events', { id: acceptedRun.id }, `/api/automation-runs/${acceptedRun.id}/events`, 'events'],
    ['product_events', { eventType: 'missing' }, '/api/automation-runs/product-events?eventType=missing', 'items'],
  ] as const) {
    const id = `xopc.automations.${operation}`;
    const descriptor = capabilities.find((item: { id: string }) => item.id === id);
    const invoked = await request(`${root}/${id}/invocations`, 'POST', {
      majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest, input,
    });
    assert.equal(invoked.status, 200, await invoked.clone().text());
    assert.deepEqual((await invoked.json()).data[field], (await (await request(path)).json())[field]);
  }
  assert.deepEqual(await (await request(`/api/automation-runs/${acceptedRun.id}/cancel`, 'POST', undefined, { 'idempotency-key': 'cancel-finished' })).json(), { cancelled: false, confirmed: false });
  const readPath = `/api/automation-runs/${acceptedRun.id}/read`;
  assert.deepEqual(await (await request(readPath, 'POST', undefined, { 'idempotency-key': 'read' })).json(), { marked: true });
  assert.deepEqual(await (await request(readPath, 'POST', undefined, { 'idempotency-key': 'read' })).json(), { marked: true });
  const readAllHeaders = { 'idempotency-key': 'read-all' };
  assert.deepEqual(await (await request('/api/automation-runs/read-all', 'POST', undefined, readAllHeaders)).json(), { count: 0 });
  assert.deepEqual((await (await request(runPath, 'POST', undefined, runHeaders)).json()).run, acceptedRun);
  const rerunPath = `/api/automation-runs/${acceptedRun.id}/rerun`;
  const rerunHeaders = { 'idempotency-key': 'rerun' };
  const rerunResponse = await request(rerunPath, 'POST', undefined, rerunHeaders);
  assert.equal(rerunResponse.status, 201, await rerunResponse.clone().text());
  const acceptedRerun = (await rerunResponse.json()).run;
  await waitForRun(acceptedRerun.id);
  assert.deepEqual(await (await request('/api/automation-runs/read-all', 'POST', undefined, readAllHeaders)).json(), { count: 0 });
  assert.deepEqual(await (await request('/api/automation-runs/read-all', 'POST', undefined, { 'idempotency-key': 'new-read-all' })).json(), { count: 1 });
  assert.deepEqual((await (await request(rerunPath, 'POST', undefined, rerunHeaders)).json()).run, acceptedRerun);
  assert.equal((await (await request(`/api/automation-runs?automationId=${runnable.id}`)).json()).runs.length, 2);
  for (const path of ['/api/projects', '/api/projects/missing', '/api/projects/missing/milestones', '/api/projects/missing/updates']) {
    const response = await request(path);
    assert.equal(response.status, path === '/api/projects' ? 200 : 404, await response.clone().text());
  }
  const ticket = await (await request('/api/realtime/tickets', 'POST', {
    clientId: 'capability-smoke', clientKind: 'web', protocolVersion: REALTIME_PROTOCOL_VERSION,
  })).json();
  socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/realtime/v1/ws');
  const resourceEvents: Array<{ id: string; revision: number; operation: string; operationId?: string }> = [];
  const projectResourceEvents: Array<{ id: string; revision: number; operation: string; operationId?: string }> = [];
  const sceneResourceEvents: Array<{ id: string; revision: number; operation: string; operationId?: string }> = [];
  let resourceSubscriptions = 0;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Resource subscription timed out')), 5000);
    socket!.once('error', error => { clearTimeout(timeout); reject(error); });
    socket!.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.kind === 'realtime.subscribed' && ++resourceSubscriptions === 3) { clearTimeout(timeout); resolve(); }
      if (message.kind === 'realtime.event' && message.payload.event === 'resource.changed') {
        if (message.payload.topic === 'resources:projects') projectResourceEvents.push(message.payload.data);
        else if (message.payload.topic === 'resources:scenes') sceneResourceEvents.push(message.payload.data);
        else resourceEvents.push(message.payload.data);
      }
    });
    socket!.once('open', () => socket!.send(JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION, messageId: crypto.randomUUID(), kind: 'realtime.hello', sentAt: Date.now(),
      payload: { ticket: ticket.payload.ticket, clientId: 'capability-smoke', clientKind: 'web', subscriptions: [{ topic: 'resources:notes' }, { topic: 'resources:projects' }, { topic: 'resources:scenes' }] },
    })));
  });
  const sceneRealtimeInput = { expectedRevision: 2, notificationsMuted: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request('/api/scenes/preferences', 'PATCH', sceneRealtimeInput, { 'idempotency-key': 'scene-realtime' });
    assert.equal(response.status, 200, await response.clone().text());
  }
  for (let attempt = 0; attempt < 100 && !sceneResourceEvents.some(event => event.id === 'preferences' && event.revision === 3); attempt++) await new Promise(resolve => setTimeout(resolve, 30));
  const sceneChanges = sceneResourceEvents.filter(event => event.id === 'preferences' && event.revision >= 3);
  assert.equal(sceneChanges.length, 1);
  assert.equal(typeof sceneChanges[0].operationId, 'string');
  const noteInput = { markdown: 'Smoke original', capturedVia: { channel: 'web' } };
  const realtimeMilestoneHeaders = { 'idempotency-key': 'realtime-milestone' };
  const realtimeMilestoneResponse = await request(milestonePath, 'POST', { title: 'Realtime milestone' }, realtimeMilestoneHeaders);
  assert.equal(realtimeMilestoneResponse.status, 201, await realtimeMilestoneResponse.clone().text());
  await request(milestonePath, 'POST', { title: 'Realtime milestone' }, realtimeMilestoneHeaders);
  for (let attempt = 0; attempt < 50 && projectResourceEvents.length < 1; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  const realtimeProject = (await (await request(`/api/projects/${project.id}`)).json()).project;
  assert.deepEqual(projectResourceEvents.map(event => [event.id, event.revision]), [[project.id, realtimeProject.version]]);
  assert.equal(typeof projectResourceEvents[0].operationId, 'string');
  const lifecycleInput = { name: 'Lifecycle events', autoUnderstand: false };
  const lifecycleResponse = await request('/api/projects', 'POST', lifecycleInput, { 'idempotency-key': 'project-create' });
  assert.equal(lifecycleResponse.status, 201, await lifecycleResponse.clone().text());
  const lifecycleProject = (await lifecycleResponse.json()).project;
  const projectCreateDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.projects.create');
  const projectCreateReplay = await request(`${root}/xopc.projects.create/invocations`, 'POST', {
    input: lifecycleInput, idempotencyKey: 'project-create',
    majorVersion: projectCreateDescriptor.majorVersion, descriptorDigest: projectCreateDescriptor.descriptorDigest,
  });
  assert.equal(projectCreateReplay.status, 200, await projectCreateReplay.clone().text());
  assert.equal((await projectCreateReplay.json()).data.project.id, lifecycleProject.id);
  const lifecycleEdit = await request(`/api/projects/${lifecycleProject.id}`, 'PATCH', { name: 'Lifecycle edited', expectedVersion: 1 }, { 'idempotency-key': 'project-edit' });
  assert.equal(lifecycleEdit.status, 200, await lifecycleEdit.clone().text());
  const editDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.projects.update');
  const projectEditReplay = await request(`${root}/xopc.projects.update/invocations`, 'POST', {
    input: { id: lifecycleProject.id, expectedVersion: 1, patch: { name: 'Lifecycle edited' } }, idempotencyKey: 'project-edit',
    majorVersion: editDescriptor.majorVersion, descriptorDigest: editDescriptor.descriptorDigest,
  });
  assert.equal(projectEditReplay.status, 200, await projectEditReplay.clone().text());
  assert.equal((await projectEditReplay.json()).data.project.version, 2);
  assert.equal((await request(`/api/projects/${lifecycleProject.id}`, 'PATCH', { name: 'Stale', expectedVersion: 1 })).status, 409);
  const pinDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.projects.set_pinned');
  const pinPath = `/api/projects/${lifecycleProject.id}/pin`;
  const pinResponse = await request(pinPath, 'POST', { expectedVersion: 2 }, { 'idempotency-key': 'project-pin' });
  assert.equal(pinResponse.status, 200, await pinResponse.clone().text());
  const pinned = (await pinResponse.json()).project;
  const pinReplay = await request(`${root}/xopc.projects.set_pinned/invocations`, 'POST', {
    input: { id: lifecycleProject.id, expectedVersion: 2, pinned: true }, idempotencyKey: 'project-pin',
    majorVersion: pinDescriptor.majorVersion, descriptorDigest: pinDescriptor.descriptorDigest,
  });
  assert.equal(pinReplay.status, 200, await pinReplay.clone().text());
  assert.equal((await pinReplay.json()).data.project.pinnedAt, pinned.pinnedAt);
  const unpinPath = `/api/projects/${lifecycleProject.id}/unpin`;
  assert.equal((await request(unpinPath, 'POST', { expectedVersion: 2 })).status, 409);
  assert.equal((await request(unpinPath, 'POST', { expectedVersion: 3 })).status, 200);
  assert.equal((await request(pinPath, 'POST', { expectedVersion: 2 }, { 'idempotency-key': 'project-pin' })).status, 200);
  assert.equal((await (await request(`/api/projects/${lifecycleProject.id}`)).json()).project.pinnedAt, undefined);
  const projectDeleteInput = { expectedVersion: 4 };
  const projectDeleteHeaders = { 'idempotency-key': 'project-delete' };
  const lifecycleDeleted = await request(`/api/projects/${lifecycleProject.id}`, 'DELETE', projectDeleteInput, projectDeleteHeaders);
  assert.equal(lifecycleDeleted.status, 200, await lifecycleDeleted.clone().text());
  assert.deepEqual(await lifecycleDeleted.json(), { ok: true, deleted: true, executionStopConfirmed: false });
  assert.equal((await request(`/api/projects/${lifecycleProject.id}`, 'DELETE', projectDeleteInput, projectDeleteHeaders)).status, 200);
  const deleteDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.projects.delete');
  const deleteReplay = await request(`${root}/xopc.projects.delete/invocations`, 'POST', {
    input: { id: lifecycleProject.id, ...projectDeleteInput }, idempotencyKey: 'project-delete',
    majorVersion: deleteDescriptor.majorVersion, descriptorDigest: deleteDescriptor.descriptorDigest,
  });
  assert.equal(deleteReplay.status, 200, await deleteReplay.clone().text());
  assert.deepEqual((await deleteReplay.json()).data, { ok: true, deleted: true, executionStopConfirmed: false });
  assert.equal((await request(`/api/projects/${lifecycleProject.id}`)).status, 404);
  for (let attempt = 0; attempt < 250 && projectResourceEvents.filter(event => event.id === lifecycleProject.id).length < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(projectResourceEvents.filter(event => event.id === lifecycleProject.id)
    .sort((left, right) => left.revision - right.revision).map(event => [event.operation, event.revision]),
  [['created', 1], ['updated', 2], ['updated', 3], ['updated', 4], ['deleted', 5]]);
  const noteDescriptor = capabilities.find((entry: { id: string }) => entry.id === 'xopc.notes.create');
  const noteResponse = await request(`${root}/xopc.notes.create/invocations`, 'POST', {
    input: noteInput, majorVersion: noteDescriptor.majorVersion, descriptorDigest: noteDescriptor.descriptorDigest, idempotencyKey: 'note-create',
  });
  assert.equal(noteResponse.status, 200, await noteResponse.clone().text());
  const note = (await noteResponse.json()).data.note;
  const contextDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.context.resolve');
  const pageSnapshot = { version: 1, clientInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tabId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sequence: 1, surface: 'web', capturedAt: Date.now(),
    resourceRefs: [{ kind: 'note', id: note.id, revision: String(note.remoteVersion ?? 1) }],
    selection: { text: 'Selected user text', draft: true },
  };
  const pageContext = await request(`${root}/xopc.context.resolve/invocations`, 'POST', {
    input: pageSnapshot, majorVersion: contextDescriptor.majorVersion, descriptorDigest: contextDescriptor.descriptorDigest,
  });
  assert.equal(pageContext.status, 200, await pageContext.clone().text());
  const resolvedContext = (await pageContext.json()).data;
  assert.equal(resolvedContext.resources[0].text, 'Smoke original');
  assert.deepEqual(resolvedContext.snapshot, pageSnapshot);
  assert.equal(resolvedContext.selectionTrust, 'user-supplied');
  const preview = await request(`/api/notes/${note.id}/ai/edit`, 'POST', { instruction: 'summary' });
  assert.equal(preview.status, 200, await preview.clone().text());
  const previewDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.notes.preview_edit');
  const sharedPreview = await request(`${root}/xopc.notes.preview_edit/invocations`, 'POST', {
    input: { id: note.id, instruction: 'summary' }, majorVersion: previewDescriptor.majorVersion, descriptorDigest: previewDescriptor.descriptorDigest,
  });
  assert.equal(sharedPreview.status, 200, await sharedPreview.clone().text());
  assert.deepEqual((await sharedPreview.json()).data.patch.operations, (await preview.json()).patch.operations);
  const noteReplay = await request('/api/notes', 'POST', { markdown: 'Smoke original', channel: 'web' }, { 'idempotency-key': 'note-create' });
  assert.equal(noteReplay.status, 201, await noteReplay.clone().text());
  assert.equal((await noteReplay.json()).note.id, note.id);
  const patch = { markdown: 'Smoke edited', expectedRevision: 1 };
  const update = await request(`/api/notes/${note.id}`, 'PATCH', patch, { 'idempotency-key': 'note-edit' });
  assert.equal(update.status, 200, await update.clone().text());
  const edited = await update.json();
  const editReplay = await request(`/api/notes/${note.id}`, 'PATCH', patch, { 'idempotency-key': 'note-edit' });
  assert.equal(editReplay.status, 200, await editReplay.clone().text());
  assert.deepEqual(await editReplay.json(), edited);
  assert.equal((await request(`/api/notes/${note.id}`, 'PATCH', patch, { 'idempotency-key': 'stale-edit' })).status, 409);
  assert.equal((await request(`/api/notes/${note.id}`, 'PATCH', { markdown: 'Missing revision' }, { 'idempotency-key': 'invalid-edit' })).status, 400);
  const historyResponse = await request(`/api/notes/${note.id}/history`);
  assert.equal(historyResponse.status, 200, await historyResponse.clone().text());
  const history = await historyResponse.json();
  assert.equal(history.entries.length, 1);
  const snapshotResponse = await request(`/api/notes/${note.id}/history/${history.entries[0].timestamp}`);
  assert.equal(snapshotResponse.status, 200, await snapshotResponse.clone().text());
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.snapshot.markdown, 'Smoke original');
  const snapshotDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.notes.snapshot');
  const sharedSnapshot = await request(`${root}/xopc.notes.snapshot/invocations`, 'POST', {
    input: { id: note.id, timestamp: history.entries[0].timestamp },
    majorVersion: snapshotDescriptor.majorVersion, descriptorDigest: snapshotDescriptor.descriptorDigest,
  });
  assert.equal(sharedSnapshot.status, 200, await sharedSnapshot.clone().text());
  assert.deepEqual((await sharedSnapshot.json()).data, snapshot);
  assert.equal((await request(`/api/notes/${note.id}/history/1junk`)).status, 400);
  assert.equal((await request('/api/notes/project-summaries')).status, 200);
  for (let attempt = 0; attempt < 50 && resourceEvents.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(resourceEvents.map(event => [event.id, event.revision]), [[note.id, 1], [note.id, 2]]);
  assert.ok(resourceEvents.every(event => typeof event.operationId === 'string'));
  const noteDeleteHeaders = { 'idempotency-key': 'note-delete' };
  const shareFixtureResponse = await request(`/api/notes/${note.id}/shares`, 'POST', {});
  assert.equal(shareFixtureResponse.status, 201, await shareFixtureResponse.clone().text());
  assert.equal((await request(`/api/notes/${note.id}`, 'DELETE', { expectedRevision: 1 }, { 'idempotency-key': 'stale-delete-note' })).status, 409);
  const deletedNoteResponse = await request(`/api/notes/${note.id}`, 'DELETE', { expectedRevision: 2 }, noteDeleteHeaders);
  assert.equal(deletedNoteResponse.status, 200, await deletedNoteResponse.clone().text());
  const deletedNote = await deletedNoteResponse.json();
  assert.equal(deletedNote.revokedShares, 1);
  assert.deepEqual(await (await request(`/api/notes/${note.id}`, 'DELETE', { expectedRevision: 2 }, noteDeleteHeaders)).json(), deletedNote);
  assert.equal((await request(`/api/notes/${note.id}`)).status, 404);
  for (let attempt = 0; attempt < 50 && resourceEvents.length < 3; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(resourceEvents.map(event => event.operation), ['created', 'updated', 'deleted']);
  assert.equal(resourceEvents[2].revision, 3);
  assert.equal(typeof resourceEvents[2].operationId, 'string');
  for (const id of ['xopc.tasks.list', 'xopc.notes.list']) {
    const descriptorResponse = await request(`${root}/${id}`);
    assert.equal(descriptorResponse.status, 200);
    const descriptor = await descriptorResponse.json();
    const body = { majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest, input: {} };
    const response = await request(`${root}/${id}/invocations`, 'POST', body);
    assert.equal(response.status, 200, await response.clone().text());
    const canonical = (await response.json()).data;
    const old = await request(id === 'xopc.tasks.list' ? '/api/tasks' : '/api/notes');
    assert.equal(old.status, 200);
    assert.deepEqual(await old.json(), canonical);
    assert.equal((await request(`${root}/${id}/invocations`, 'POST', { ...body, majorVersion: 999 })).status, 409);
    assert.equal((await request(`${root}/${id}/invocations`, 'POST', { ...body, input: { principalId: 'owner' } })).status, 400);
  }
  assert.equal((await request(`${root}/xopc.unknown.get`)).status, 404);
  const createInput = { title: 'Durable smoke task', contract: { ...defineTaskContract('Validate local capability writes'),
    acceptancePolicy: 'manual', outputDestinations: [] }, activation: { mode: 'capture', phase: 'backlog' } };
  const createDescriptor = capabilities.find((entry: { id: string }) => entry.id === 'xopc.tasks.create');
  const createBody = { input: createInput, majorVersion: createDescriptor.majorVersion,
    descriptorDigest: createDescriptor.descriptorDigest, idempotencyKey: 'smoke-create' };
  const createdResponse = await request(`${root}/xopc.tasks.create/invocations`, 'POST', createBody);
  assert.equal(createdResponse.status, 200, await createdResponse.clone().text());
  const created = (await createdResponse.json()).data;
  assert.equal(created.ok, true);
  assert.equal((await resolvePage('task', created.model.task.id, String(created.model.task.version))).text, 'Validate local capability writes');
  const repeated = await request('/api/tasks', 'POST', { ...createInput, idempotencyKey: 'smoke-create' });
  assert.equal(repeated.status, 201, await repeated.clone().text());
  assert.equal((await repeated.json()).task.id, created.model.task.id);
  const command = { idempotencyKey: 'smoke-command', expectedVersion: created.model.task.version, command: { type: 'mark_ready' } };
  const changed = await request(`/api/tasks/${created.model.task.id}/commands`, 'POST', command);
  assert.equal(changed.status, 200, await changed.clone().text());
  const changedBody = await changed.json();
  assert.equal(changedBody.task.phase, 'ready');
  const replay = await request(`/api/tasks/${created.model.task.id}/commands`, 'POST', command);
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.deepEqual(await replay.json(), changedBody);
  const startResponse = await request(`/api/tasks/${created.model.task.id}/commands`, 'POST', {
    idempotencyKey: 'start-human', expectedVersion: changedBody.task.version,
    command: { type: 'start', executor: { kind: 'human', actorId: 'smoke-owner' } },
  });
  assert.equal(startResponse.status, 200, await startResponse.clone().text());
  const started = await startResponse.json();
  const taskRun = (await (await request(`/api/task-runs/${started.run.id}`)).json()).run;
  const cancelPath = `/api/task-runs/${taskRun.id}/cancel`;
  const cancelInput = { expectedVersion: taskRun.version };
  assert.equal((await request(cancelPath, 'POST', null)).status, 400);
  const cancelHeaders = { 'idempotency-key': 'cancel-human' };
  const cancelledResponse = await request(cancelPath, 'POST', cancelInput, cancelHeaders);
  assert.equal(cancelledResponse.status, 200, await cancelledResponse.clone().text());
  const cancelled = await cancelledResponse.json();
  assert.equal(cancelled.run.status, 'cancelled');
  assert.equal(cancelled.executionStopConfirmed, false);
  assert.deepEqual(await (await request(cancelPath, 'POST', cancelInput, cancelHeaders)).json(), cancelled);
  const feedbackInput = { rating: 'not_helpful', reason: 'Isolated verification' };
  const feedbackPath = `/api/task-runs/${taskRun.id}/feedback`;
  const feedbackResponse = await request(feedbackPath, 'POST', feedbackInput, { 'idempotency-key': 'feedback' });
  assert.equal(feedbackResponse.status, 200, await feedbackResponse.clone().text());
  const feedback = await feedbackResponse.json();
  const feedbackDescriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.task_runs.feedback');
  const feedbackReplay = await request(`${root}/xopc.task_runs.feedback/invocations`, 'POST', {
    input: { ...feedbackInput, id: taskRun.id }, idempotencyKey: 'feedback',
    majorVersion: feedbackDescriptor.majorVersion, descriptorDigest: feedbackDescriptor.descriptorDigest,
  });
  assert.equal(feedbackReplay.status, 200, await feedbackReplay.clone().text());
  assert.deepEqual((await feedbackReplay.json()).data, feedback);
  assert.equal((await request(feedbackPath, 'POST', { rating: 'invalid' })).status, 400);
  const taskMetrics = await request('/api/tasks/metrics');
  assert.equal(taskMetrics.status, 200, await taskMetrics.clone().text());
  assert.equal((await taskMetrics.json()).metrics.tasks.userCorrected, 1);
  const listed = await request('/api/tasks');
  assert.equal((await listed.json()).total, 1);
  console.log('Capability Gateway smoke passed: auth, lazy routing, cross-entry receipts, project writes, task cancellation, automation diagnostics and resource realtime.');
} finally {
  socket?.close();
  if (child.exitCode === null) {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    await exited;
    clearTimeout(timeout);
  }
  rmSync(directory, { recursive: true, force: true });
}
