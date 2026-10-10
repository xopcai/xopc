import { automationSessions } from '../session-manager';
import { browserDom, type BrowserRecordingEvent } from '@xopcai/browser-control-contract';

import { gatewayFetch, readProfile } from '../sidepanel/auth';
import { appendRecordingEvent, deleteRecordingEvents, recordingEvents, recordings, saveRecording, patchRecording } from './store';

let uploadTask: Promise<void> | undefined;
let resyncRequested = false;
let controlTask: Promise<unknown> | undefined;
let claim: { endpointId: string; token: string } | undefined;
export function setRecordingClaim(value: typeof claim) { claim = value; void syncRecordings(); }

async function inject(tabId: number, input: Parameters<typeof browserDom>[0]) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func: browserDom, args: [input] });
  return result[0]?.result;
}
export async function recordingCommand(operation: string, tabId?: number) {
  if (operation === 'status') return recordings();
  if (controlTask) throw new Error('A recording action is already in progress.');
  controlTask = control(operation, tabId);
  try { return await controlTask; } finally { controlTask = undefined; }
}
async function control(operation: string, tabId?: number) {
  const all = await recordings();
  const active = all.find((item) => item.state === 'recording' || item.state === 'paused');
  if (operation === 'start') {
    if (active) return active;
    const profile = await readProfile();
    if (!profile) throw new Error('Connect to your Gateway first.');
    if (tabId !== undefined && (!Number.isInteger(tabId) || tabId <= 0)) throw new Error('Invalid recording tab.');
    const tab = tabId !== undefined ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!tab?.id || !tab.url?.match(/^https?:\/\//)) throw new Error('RECORDING_PAGE_UNAVAILABLE');
    if ([...automationSessions.values()].some((session) => session.tabIds.includes(tab.id!))) throw new Error('This page belongs to a running browser task. Select your workflow page to record.');
    const session = { id: crypto.randomUUID(), state: 'recording' as const, tabId: tab.id,
      gatewayId: profile.gatewayId, deviceId: profile.deviceId, generation: 1, count: 0, ack: 0, bytes: 0, createdAtMs: Date.now() };
    await saveRecording(session);
    try { await inject(tab.id, { operation: 'record', recordingId: session.id, generation: session.generation }); }
    catch (error) { await patchRecording(session.id, { state: 'interrupted', error: String(error) }); throw error; }
    await chrome.action.setBadgeText({ text: 'REC' });
    return session;
  }
  if (!active) throw new Error('There is no active recording.');
  if (operation === 'resume') {
    if (active.state !== 'paused') return active;
    const session = { ...active, state: 'recording' as const, generation: active.generation + 1 };
    await patchRecording(session.id, { state: session.state, generation: session.generation });
    try { await inject(session.tabId, { operation: 'record', recordingId: session.id, generation: session.generation }); }
    catch (error) { await patchRecording(session.id, { state: 'interrupted', error: String(error) }); throw error; }
    await chrome.action.setBadgeText({ text: 'REC' });
    return session;
  }
  if (operation !== 'pause' && operation !== 'finish') throw new Error('Unknown recording operation.');
  try { await inject(active.tabId, { operation: 'stop' }); }
  catch (error) {
    const current = (await recordings()).find((item) => item.id === active.id)!;
    await patchRecording(current.id, { state: 'interrupted', error: `Recording may be incomplete: ${String(error)}` });
    throw error;
  }
  const current = (await recordings()).find((item) => item.id === active.id)!;
  const session = { ...current, state: operation === 'pause' ? 'paused' as const : 'stopped' as const };
  await patchRecording(session.id, { state: session.state });
  await chrome.action.setBadgeText({ text: operation === 'pause' ? 'Ⅱ' : '' });
  void syncRecordings();
  return session;
}

export async function acceptRecordingEvent(message: { recordingId: string; generation: number; event: Omit<BrowserRecordingEvent, 'seq'> }, sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || sender.frameId !== 0) throw new Error('Invalid recording source.');
  const event = message.event;
  if (!event || JSON.stringify(event).length > 16_384 || !['navigate', 'click', 'fill', 'select', 'check', 'press', 'checkpoint', 'unsupported'].includes(event.action)) throw new Error('Invalid recording event.');
  try { await appendRecordingEvent(message.recordingId, message.generation, sender.tab.id, event); }
  catch (error) {
    if (/limit reached/.test(String(error))) {
      await patchRecording(message.recordingId, { state: 'interrupted', error: String(error) });
      void inject(sender.tab.id, { operation: 'stop' }).catch(() => undefined);
      await chrome.action.setBadgeText({ text: '' });
    }
    throw error;
  }
  void syncRecordings();
}

export function syncRecordings(): Promise<void> {
  if (uploadTask) { resyncRequested = true; return uploadTask; }
  uploadTask = upload().catch(() => undefined).finally(() => {
    uploadTask = undefined;
    if (resyncRequested) { resyncRequested = false; void syncRecordings(); }
  });
  return uploadTask;
}
async function upload() {
  if (!claim) return;
  const profile = await readProfile();
  if (!profile) return;
  for (const session of await recordings()) {
    if (session.gatewayId !== profile.gatewayId || session.deviceId !== profile.deviceId || session.automationId) continue;
    try {
      const post = async (operation: string, body: unknown) => {
        const response = await gatewayFetch(`/api/browser/recordings/${session.id}/${operation}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-endpoint-id': claim!.endpointId, 'x-endpoint-claim': claim!.token }, body: JSON.stringify(body) }, profile);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Recording could not be synchronized.');
        return data;
      };
      let ack = session.ack;
      let events = await recordingEvents(session.id, ack);
      while (events.length) {
        while (JSON.stringify({ events }).length > 240_000) events.pop();
        const data = await post('events', { events });
        if (data.ackThrough <= ack) throw new Error('Recording synchronization did not advance.');
        ack = data.ackThrough;
        const current = (await recordings()).find((item) => item.id === session.id)!;
        await patchRecording(current.id, { ack, error: undefined });
        events = await recordingEvents(session.id, ack);
      }
      const current = (await recordings()).find((item) => item.id === session.id)!;
      if (current.state === 'stopped' && current.count === ack) {
        const data = await post('finish', { finalSeq: current.count });
        await patchRecording(current.id, { ack, automationId: data.automation.id, error: undefined });
        await deleteRecordingEvents(session.id, current.count);
      }
    } catch (error) {
      const current = (await recordings()).find((item) => item.id === session.id)!;
      await patchRecording(current.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  void recordings().then(async (all) => {
    const session = all.find((item) => item.tabId === tabId && item.state === 'recording');
    if (!session) return;
    try {
      await patchRecording(session.id, { generation: session.generation + 1 });
      await inject(tabId, { operation: 'record', recordingId: session.id, generation: session.generation + 1 });
    }
    catch (error) { await patchRecording(session.id, { state: 'interrupted', error: String(error) }); }
  });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void recordings().then(async (all) => {
    for (const session of all.filter((item) => item.tabId === tabId && ['recording', 'paused'].includes(item.state))) {
      await patchRecording(session.id, { state: 'interrupted', error: 'The recorded tab was closed. The partial recording is saved locally.' });
    }
  });
});
chrome.runtime.onStartup.addListener(() => {
  void recordings().then(async (all) => { for (const session of all.filter((item) => item.state === 'recording')) await patchRecording(session.id, { state: 'interrupted', error: 'Browser restarted. The recording was stopped.' }); });
});
