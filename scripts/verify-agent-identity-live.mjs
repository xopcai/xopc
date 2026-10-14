// Real authenticated Gateway acceptance. Use node --import tsx/esm to run.
// Optional: XOPC_IDENTITY_MODELS (comma-separated), XOPC_IDENTITY_REPORT,
// XOPC_IDENTITY_GATEWAY, XOPC_CONFIG_PATH. No credentials are written to reports.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RealtimeClient } from '../packages/realtime-client/src/index.ts';
import { REALTIME_PROTOCOL_VERSION } from '../packages/realtime-protocol/src/index.ts';

const configPath = process.env.XOPC_CONFIG_PATH ?? join(homedir(), '.xopc/xopc.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const base = process.env.XOPC_IDENTITY_GATEWAY ?? `http://127.0.0.1:${config.gateway.port ?? 18790}`;
const models = (process.env.XOPC_IDENTITY_MODELS
  ?? 'deepseek/deepseek-flash,minimax-cn/MiniMax-M2.7,deepseek/deepseek-v4-pro').split(',');
const reportPath = resolve(process.env.XOPC_IDENTITY_REPORT ?? '/tmp/xopc-agent-identity-live.json');
const workspace = mkdtempSync(join(tmpdir(), 'xopc-identity-live-'));
const agentId = `identity-live-${randomUUID().slice(0, 8)}`;
const db = new DatabaseSync(join(process.env.XOPC_STATE_DIR ?? dirname(configPath), 'xopc.db'), { readOnly: true });
const report = { startedAt: new Date().toISOString(), gateway: base, models, checks: [], errors: [], cleanup: {} };
const originalProfile = { name: 'Ada', description: 'A botany educator who teaches people about plants.',
  creature: 'AI assistant', style: 'Clear and concise', language: 'en' };
let profile = { ...originalProfile };
let created = false;
let connected = false;
let conversationId;
const conversations = [];
const events = [];
const clientId = `identity-live-${randomUUID().slice(0, 8)}`;

async function api(path, body, method) {
  const response = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { authorization: `Bearer ${config.gateway.auth.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data.payload ?? data;
}

async function until(predicate, label, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout: ${label}`);
}

const realtime = new RealtimeClient({ clientId, clientKind: 'tui',
  getWebSocketUrl: () => base.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
  issueTicket: () => api('/api/realtime/tickets', { clientId, clientKind: 'tui', protocolVersion: REALTIME_PROTOCOL_VERSION }),
  createWebSocket: url => new WebSocket(url),
  onStateChange: state => { connected = state === 'connected'; },
  onEvent: event => {
    events.push(event);
    if (event.event === 'run.started' && conversations.includes(event.data.conversationId))
      realtime.subscribe(`run:${event.data.runId}`, 0);
  },
});

async function updateProfile(patch) {
  profile = { ...profile, ...patch };
  await api(`/api/agents/${agentId}`, { profile }, 'PATCH');
  const saved = (await api(`/api/agents/${agentId}/effective-config`)).config.profile;
  if (JSON.stringify(saved) !== JSON.stringify(profile)) {
    for (const [key, value] of Object.entries(profile))
      if (saved[key] !== value) throw new Error(`Profile field not saved: ${key}`);
  }
}

async function newConversation(model) {
  conversationId = randomUUID();
  conversations.push(conversationId);
  await api(`/api/sessions/${conversationId}/materialize`, { commandId: randomUUID(), purpose: 'session_resources',
    creation: { agentId, projectId: null, execution: null, temporary: false, model, thinkingLevel: 'off' } });
  await until(async () => {
    try { return Boolean((await api(`/api/sessions/${conversationId}`)).session?.transcriptId); }
    catch { return false; }
  }, 'conversation preparation', 30000);
  await api(`/api/sessions/${conversationId}/agent-config`, { userContextMode: 'off', responseLanguage: 'auto' }, 'PATCH');
}

async function check(model, scenario, question, predicate) {
  const session = (await api(`/api/sessions/${conversationId}`)).session;
  const selection = await api(`/api/sessions/${conversationId}/agent-config`);
  if (selection.model !== model) throw new Error(`Unexpected model selection: ${selection.model}`);
  const seq = db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM transcript_entries WHERE transcript_id=?')
    .get(session.transcriptId).seq;
  const eventCount = events.length;
  const started = Date.now();
  const receipt = await api(`/api/sessions/${conversationId}/inputs`, { kind: 'append', clientMessageId: randomUUID(),
    expectedTranscriptId: session.transcriptId, configVersion: selection.configVersion, delivery: 'next', interrupt: false,
    input: { content: question }, origin: { type: 'system', source: 'cli' } });
  await until(() => events.slice(eventCount).some(event => event.event === 'run.completed'
    && event.data.conversationId === conversationId), `${model}: ${scenario}`);
  const completion = events.slice(eventCount).findLast(event => event.event === 'run.completed'
    && event.data.conversationId === conversationId);
  const messages = db.prepare("SELECT payload_json FROM transcript_entries WHERE transcript_id=? AND seq>? AND role='assistant' ORDER BY seq")
    .all(session.transcriptId, seq).map(row => JSON.parse(row.payload_json));
  const reply = messages.map(message => typeof message.content === 'string' ? message.content
    : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n')).join('\n');
  const result = { model, scenario, profile: { ...profile }, question, reply, status: completion.data.status,
    runId: completion.data.runId, inputId: receipt.receipt?.inputId, elapsedMs: Date.now() - started,
    actualModels: [...new Set(messages.map(message => `${message.provider}/${message.model}`))],
    passed: completion.data.status === 'success' && predicate(reply) };
  report.checks.push(result);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(result));
}

const english = text => /[A-Za-z]{3}/.test(text) && !/[\u4e00-\u9fff]/.test(text.replaceAll('岚舟', ''));
const chinese = text => (text.replaceAll('岚舟', '').match(/[\u4e00-\u9fff]/g) ?? []).length >= 8;
const astronomy = text => /astronom|star|sky|constellation|planet|天文|星|天空/i.test(text);
const botany = text => /botan|plant|leaf|seed|植物|叶|种子/i.test(text);
const firstSentence = text => text.trim().split(/[\n.!?。！？]/)[0];

try {
  mkdirSync(dirname(reportPath), { recursive: true });
  await until(async () => { try { return (await api('/api/health')).ready === true; } catch { return false; } }, 'Gateway health', 60000);
  await api('/api/agents', { id: agentId, workspace, profile });
  created = true;
  await api(`/api/agents/${agentId}`, { toolAllowlist: [], skills: { mode: 'replace', include: [] },
    runtime: { thinkingLevel: 'off' } }, 'PATCH');
  // A stale file is deliberately retained while catalog fields change.
  await api(`/api/agents/${agentId}/files/SOUL.md`, { content: 'Earlier profile notes: Ada is a botany educator and speaks English.' }, 'PUT');
  realtime.subscribe('sessions');
  realtime.connect();
  await until(() => connected, 'realtime authentication', 15000);
  for (const model of models) {
    try {
      await updateProfile(originalProfile);
      await newConversation(model);
      await check(model, 'baseline_name', 'What is your name? Reply with just your name.', text => firstSentence(text).includes('Ada'));
      await check(model, 'baseline_role', 'Describe your current specialty in one sentence.', text => botany(text) && english(text));
      await updateProfile({ name: 'Orion' });
      await check(model, 'rename_with_history', 'What is your name? Reply with just your name.', text => firstSentence(text).includes('Orion') && !/Ada/.test(firstSentence(text)));
      await updateProfile({ description: 'An astronomy educator who teaches people about stars and the night sky.' });
      await check(model, 'role_change_with_history', 'Describe your current specialty in one sentence.', text => astronomy(text) && !botany(text));
      await check(model, 'role_behavior', 'Suggest one beginner activity in your current specialty. Keep it to one sentence.', text => astronomy(text) && !botany(text));
      await updateProfile({ name: '岚舟' });
      await check(model, 'second_rename', 'What is your name? Reply with just your name.', text => firstSentence(text).includes('岚舟') && !/Ada|Orion/.test(firstSentence(text)));
      await updateProfile({ language: 'zh-CN' });
      await check(model, 'language_zh_against_english_question', 'Describe your current specialty in one sentence.', text => chinese(text) && astronomy(text));
      await updateProfile({ language: 'fr' });
      await check(model, 'language_fr_against_english_history', 'Introduce yourself and your specialty in one short sentence.', text => text.includes(profile.name) && /\b(je|suis|mon|une?|astronomie|éducateur)\b/i.test(text) && /astronom|étoile|ciel/i.test(text) && !chinese(text));
      await check(model, 'explicit_turn_language_override', 'Please answer in English: describe your current specialty in one short sentence.', text => english(text) && astronomy(text));
      await api(`/api/sessions/${conversationId}/agent-config`, { responseLanguage: 'zh-CN' }, 'PATCH');
      await check(model, 'fixed_session_language_override', 'Describe your current specialty in one sentence.', text => chinese(text) && astronomy(text));
      await api(`/api/sessions/${conversationId}/agent-config`, { responseLanguage: 'auto' }, 'PATCH');
      await updateProfile(originalProfile);
      await check(model, 'restore_role_and_language', 'Describe your current specialty in one sentence.', text => botany(text) && english(text) && !astronomy(text));
    } catch (error) {
      report.errors.push({ model, error: String(error) });
      console.log(JSON.stringify({ model, error: String(error) }));
    }
  }
} catch (error) {
  report.errors.push({ error: String(error) });
} finally {
  realtime.disconnect();
  for (const id of conversations) {
    try { await api(`/api/sessions/${id}`, undefined, 'DELETE'); }
    catch (error) { report.errors.push({ cleanupConversation: id, error: String(error) }); }
  }
  if (created) {
    try { await api(`/api/agents/${agentId}?purge=1`, undefined, 'DELETE'); report.cleanup.agentPurged = true; }
    catch (error) { report.errors.push({ cleanupAgent: agentId, error: String(error) }); }
  }
  db.close();
  rmSync(workspace, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  report.passed = report.errors.length === 0 && report.checks.length === models.length * 11 && report.checks.every(check => check.passed);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, reportPath, errors: report.errors }));
  if (!report.passed) process.exitCode = 1;
}
