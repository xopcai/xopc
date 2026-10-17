/** Electron-only live test against one already-open disposable TextEdit document. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { app } from 'electron';
import type { ComputerAction, ComputerObservation } from '@xopcai/computer-control-contract';
import { CuaComputerDriver } from '../electron/computer/cua-driver.js';
import { ComputerBroker, type BrokerResult } from '../src/computer/broker.js';

type Element = { ref: string; role: string; element_index: string; parent_index?: string; semanticActions?: string[] };
const SCRATCH_TEXT = 'XOPC native context menu validation. Disposable text only.\n';

function contextMenu(observation: ComputerObservation) {
  const { elements } = JSON.parse(observation.summary) as { elements: Element[] };
  const fields = elements.filter(element => element.role === 'AXTextArea' && element.semanticActions?.includes('showMenu'));
  assert.equal(fields.length, 1, 'Expected one native TextEdit text area');
  const field = fields[0];
  const menus = elements.filter(element => element.role === 'AXMenu' && element.parent_index === field.element_index);
  const items = elements.filter(element => element.role === 'AXMenuItem' && menus.some(menu => menu.element_index === element.parent_index));
  assert.ok(!elements.some(element => element.role === 'AXMenuBar'), 'Application menus must remain excluded');
  return { field, menus, items };
}

async function main() {
  await app.whenReady();
  const [binary, document, screenshot] = process.argv.slice(2);
  assert.ok(binary && document, 'Pass the verified driver binary and an already-open scratch .txt path');
  assert.match(basename(document), /^xopc-context-menu-[a-z0-9-]+\.txt$/);
  assert.equal(await readFile(document, 'utf8'), SCRATCH_TEXT, 'Only the disposable test document is allowed');
  const driver = new CuaComputerDriver(binary, 'com.github.Electron');
  const signal = AbortSignal.timeout(30_000);
  const resolveTarget = driver.resolveTarget.bind(driver);
  driver.resolveTarget = async (...args) => {
    const target = await resolveTarget(...args);
    // Tighten the ordinary binding before any window content or pixels are read.
    const windows = await (driver as any).listWindows(target.pid, signal);
    assert.equal(windows.find((window: any) => String(window.windowId) === target.windowId)?.title, basename(document));
    return target;
  };
  let menuDispatches = 0;
  const perform = driver.perform.bind(driver);
  driver.perform = async (target, action, signal) => {
    if (action.kind === 'showMenu') menuDispatches++;
    return perform(target, action, signal);
  };
  const broker = new ComputerBroker(driver, {
    isVisible: () => true, requestApproval: async () => true,
  }, { enabled: true });
  const owner = 'textedit-context-menu-validation';
  const sessionId = randomUUID();
  let menuMayBeOpen = false;
  const command = (observed: BrokerResult, action: ComputerAction) => ({
    op: 'act' as const, owner, sessionId, envelope: {
      actionId: randomUUID(), sessionId, observationId: observed.observation!.id,
      brokerEpoch: observed.brokerEpoch, generation: observed.generation, grantId: observed.grantId!,
      deadlineAt: Date.now() + 10_000, action,
    },
  });
  const dispatch = async (input: ReturnType<typeof command>) => {
    let result = await broker.command(input);
    if (result.status === 'pending_action') {
      await new Promise(resolve => setTimeout(resolve, 0));
      result = await broker.command(input);
    }
    return result;
  };
  try {
    const catalog = await broker.command({ op: 'discover', owner, sessionId: 'discovery', query: 'com.apple.TextEdit' });
    assert.equal(catalog.apps?.length, 1);
    let opened = await broker.command({ op: 'open', owner, sessionId, appRef: catalog.apps[0].appRef,
      mode: 'control', prepare: false, model: { modelRef: 'synthetic/no-inference', profile: 'structured-tools-v1',
        origin: 'https://synthetic.invalid', runtimeLocation: 'local' } });
    while (opened.status === 'pending_authorization') {
      signal.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 20));
      opened = await broker.command({ op: 'status', owner, sessionId });
    }
    assert.equal(opened.status, 'ready', opened.errorCode);
    const before = await broker.command({ op: 'observe', owner, sessionId });
    before.frame?.bytes.fill(0);
    const baseline = contextMenu(before.observation!);
    assert.equal(baseline.menus.length, 0, 'Dismiss any preexisting context menu before starting');
    const action = command(before, { kind: 'showMenu', ref: baseline.field.ref });
    menuMayBeOpen = true;
    const after = await dispatch(action);
    try {
      assert.equal(after.receipt?.dispatch, 'completed', JSON.stringify({ status: after.status, errorCode: after.errorCode, receipt: after.receipt }));
      assert.equal(after.receipt.outcome, 'unknown', 'Dispatch acknowledgement must not claim business success');
      assert.equal(after.observation!.target.windowId, before.observation!.target.windowId);
      assert.equal(after.observation!.target.processIdentity, before.observation!.target.processIdentity);
      const actual = contextMenu(after.observation!);
      assert.equal(actual.menus.length, 1, 'AXMenu must appear under the exact text area');
      assert.ok(actual.items.length >= 3, 'The actual context menu must contain native menu items');
      if (screenshot) {
        assert.ok(after.frame, 'Expected a fresh menu screenshot');
        await writeFile(screenshot, after.frame.bytes);
      }
      const replay = await broker.command(action);
      assert.deepEqual(replay.receipt, after.receipt);
      assert.equal(menuDispatches, 1, 'Receipt replay must not open the menu again');
      const dismissed = await dispatch(command(after, { kind: 'pressKeys', keys: ['Escape'] }));
      dismissed.frame?.bytes.fill(0);
      assert.equal(dismissed.receipt?.dispatch, 'completed', dismissed.errorCode);
      assert.equal(contextMenu(dismissed.observation!).menus.length, 0, 'Escape must dismiss the actual menu');
      menuMayBeOpen = false;
      assert.equal(await readFile(document, 'utf8'), SCRATCH_TEXT);
      console.log(JSON.stringify({ status: 'passed', app: 'com.apple.TextEdit', windowBound: true,
        nativeContextMenuVerified: true, nativeMenuItems: actual.items.length, receiptReplayDeduplicated: true,
        menuDismissalVerified: true, documentUnchanged: true, modelInference: false }));
    } finally { after.frame?.bytes.fill(0); }
  } finally {
    // Only dismiss in this still-active, scratch-bound lease; never reopen after a refusal.
    try {
      if (menuMayBeOpen && broker.snapshot().status === 'ready') {
        const current = await broker.command({ op: 'observe', owner, sessionId });
        current.frame?.bytes.fill(0);
        if (contextMenu(current.observation!).menus.length) {
          const dismissed = await dispatch(command(current, { kind: 'pressKeys', keys: ['Escape'] }));
          dismissed.frame?.bytes.fill(0);
        }
      }
    } finally { await broker.dispose(); }
  }
}
void main().then(() => app.exit(0), error => {
  console.error(error instanceof Error ? error.message : 'Context menu verification failed');
  app.exit(1);
});
