// Invoke through CUA against browser-e2e-electron.mjs after runNativeBrowserE2e.
// All input goes through native UI; fixture files only verify real shell/save effects.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function* runNativeWorkspaceExtras(app, { motion = true } = {}) {
  const fixture = JSON.parse(await readFile('/tmp/xopc-workspace-e2e.json', 'utf8'));
  const checks = [];
  const snapshot = () => app.getAXState({ emit: false, disableDiffing: true });
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const click = async text => {
    const lines = (await snapshot()).split('\n').filter(l => /^\s*\d+ /.test(l) && (text instanceof RegExp ? text.test(l) : l.includes(text)));
    if (lines.length !== 1) throw new Error(`${text}: expected one native target, found ${lines.length}`);
    await app.click(Number(lines[0].trim().split(' ')[0]));
    return snapshot();
  };
  const menu = async label => { await click(/^\s*\d+ XOPC Workspace Acceptance$/); return click(label); };
  let state = await snapshot();
  const header = state.slice(state.indexOf('heading Initialize Workspace E2E'), state.indexOf('text Today'));
  check('Exactly three outer action entries', ['pop up button Chat menu', 'pop up button Session info', 'toggle button Description: Open workspace tools'].every(t => header.includes(t)) && !/Open terminal|Open side chat|Find in conversation|Share conversation|Project Files:/.test(header));
  state = await click('pop up button Chat menu');
  check('Chat menu occludes native browser', state.includes('menu Chat menu') && !state.includes('HTML content Page Two'));
  state = await click('Find in conversation ⌘F');
  check('Search receives keyboard focus', /focused UI element is \d+ search text field.*Find in conversation/.test(state));
  await app.paste('Initialize');
  state = await snapshot();
  check('Search matches main transcript', state.includes('1 / 1 results'));
  await click('button Close find'); await click('pop up button Chat menu');
  state = await click(' Share conversation');
  check('Share review occludes native browser', state.includes('Create a read-only snapshot') && !state.includes('HTML content Page Two'));
  state = await click('button Cancel');
  check('Share restores menu trigger focus and native browser', /focused UI element is \d+ pop up button Chat menu/.test(state) && state.includes('HTML content Page Two'));
  state = await click('pop up button Session info');
  check('Context preserves run environment', state.includes('Run location') && state.includes(fixture.workspace) && !state.includes('HTML content Page Two'));
  await app.pressKey('Escape'); await snapshot();
  state = await click('toggle button Description: Open workspace tools');
  check('Desktop Tools exposes files sidechat browser terminal', ['button Files', 'button Side chat', 'button Browser', 'button Terminal'].every(t => state.includes(t)));
  const count = Number(state.match(/Tab list \((\d+)\)/)?.[1]);
  state = await click('toggle button Description: Open workspace tools');
  check('Repeated outer Plus reuses Tools', Number(state.match(/Tab list \((\d+)\)/)?.[1]) === count);
  yield [...checks];

  state = await click('button Terminal,');
  check('Real terminal mounts and focuses input', /focused UI element.*Terminal input/.test(state));
  await app.paste("export XOPC_E2E_KEEP=retained; printf '%s\\n' \"$XOPC_E2E_KEEP\" > terminal-e2e.txt; pwd");
  await app.pressKey('Return'); await snapshot();
  check('Real PTY writes in conversation workspace', (await readFile(join(fixture.workspace, 'terminal-e2e.txt'), 'utf8')).trim() === 'retained');
  state = await click('tab (settable, integer) Page Two,');
  check('Browser coexists with terminal', state.includes('HTML content Page Two') && state.includes('Terminal input'));
  state = await click('tab (settable, integer) report.md,');
  check('File coexists with terminal', state.includes('text entry area (settable) # Workspace E2E') && state.includes('Terminal input'));
  check('File edit was saved through real Gateway', (await readFile(join(fixture.workspace, 'report.md'), 'utf8')).includes('Native E2E file saved.'));
  state = await click('tab (settable, integer) Side chat,');
  check('Sidechat coexists with terminal', state.includes('text aborted') && state.includes('Terminal input'));
  await click('button Hide terminal'); await click('toggle button Description: Open workspace tools');
  state = await click('button Terminal,');
  check('Reopen terminal keeps original tab', state.includes('Terminal 1') && !state.includes('Terminal 2'));
  await click('text field (settable) Terminal input');
  await app.paste("printf '%s\\n' \"$XOPC_E2E_KEEP\" >> terminal-e2e.txt");
  await app.pressKey('Return'); await snapshot();
  check('Hide and reopen preserves shell process state', (await readFile(join(fixture.workspace, 'terminal-e2e.txt'), 'utf8')).trim() === 'retained\nretained');
  state = await click('button New terminal');
  check('Multiple real terminals', state.includes('Terminal 2'));
  await click('button Description: Close terminal 2,');
  state = await click('button Hide terminal');
  check('Closing extra terminal keeps original', !state.includes('Terminal 2'));
  yield [...checks];

  if (motion) checks.push(...await runNativeWorkspaceMotion(app));
  return checks;
}

export async function runNativeWorkspaceMotion(app) {
  const checks = [];
  const snapshot = () => app.getAXState({ emit: false, disableDiffing: true });
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const click = async text => {
    const lines = (await snapshot()).split('\n').filter(l => /^\s*\d+ /.test(l) && (text instanceof RegExp ? text.test(l) : l.includes(text)));
    if (lines.length !== 1) throw new Error(`${text}: expected one native target, found ${lines.length}`);
    await app.click(Number(lines[0].trim().split(' ')[0]));
    return snapshot();
  };
  const menu = async label => { await click(/^\s*\d+ XOPC Workspace Acceptance$/); return click(label); };
  await menu('Desktop size');
  let state = await snapshot();
  if (!state.includes('tab (selected) Page Two,')) await click('tab (settable, integer) Page Two,');
  await menu('Start transition trace');
  await click('toggle button Description: Open workspace tools');
  state = await click('button Terminal,');
  check('Terminal opens during trace', state.includes('Terminal input'));
  state = await click('tab (settable, integer) Page Two,');
  check('Browser remains aligned while terminal is open', state.includes('HTML content Page Two') && state.includes('Terminal input'));
  state = await click('button Hide terminal');
  check('Browser remains visible after terminal exit motion', state.includes('HTML content Page Two'));
  for (let i = 0; i < 3; i++) {
    await click('tab (settable, integer) report.md,');
    await click('tab (settable, integer) Side chat,');
    state = await click('tab (settable, integer) Page Two,');
    check(`Switch cycle ${i + 1} restores native content`, state.includes('HTML content Page Two'));
  }
  state = await click('button Expand workspace');
  check('Expanded native browser renders', state.includes('HTML content Page Two') && state.includes('button Restore workspace'));
  await click('button Restore workspace');
  await click('button Description: Collapse workspace');
  await click('toggle button Description: Open workspace tools');
  state = await click('tab (settable, integer) Page Two,');
  check('Pane transition restores native content', state.includes('HTML content Page Two'));
  await menu('Save transition trace');
  state = await menu('Compact size');
  check('Compact viewport uses full pane', state.includes('Back to chat') && state.includes('HTML content Page Two'));
  state = await click('toggle button Description: Toggle file tree,');
  check('Compact tree overlay hides native guest', state.includes('button Close file tree') && !state.includes('HTML content Page Two'));
  await app.pressKey('Escape'); await snapshot();
  state = await menu('Narrow size');
  check('Narrow viewport retains browser controls', state.includes('Search or enter a URL') && state.includes('Back to chat'));
  state = await click('button Description: Back to chat');
  check('Narrow pane closes and restores Plus focus', !state.includes('HTML content Page Two') && /focused UI element.*Open workspace tools/.test(state));
  await menu('Desktop size');
  await click('toggle button Description: Open workspace tools');
  await click('tab (settable, integer) Page Two,');
  state = await menu('Crash active browser');
  check('Browser crash is recoverable host UI', state.includes('This page stopped responding. Reload to recover.') && !state.includes('HTML content Page Two'));
  const recoveryState = await snapshot();
  const retry = recoveryState.slice(recoveryState.indexOf('container Files and side chats')).split('\n').filter(line => /^\s*\d+ button Retry$/.test(line));
  if (retry.length !== 1) throw new Error('Expected one browser recovery action');
  await app.click(Number(retry[0].trim().split(' ')[0]));
  state = await snapshot();
  check('Reload recovers crashed guest', state.includes('HTML content Page Two'));
  await writeFile('/tmp/xopc-acceptance-native-final.png', await app.getScreenshot({ emit: false }));
  return checks;
}

export async function runNativeNewSessionTerminal(app) {
  const fixture = JSON.parse(await readFile('/tmp/xopc-workspace-e2e.json', 'utf8'));
  const checks = [];
  const snapshot = () => app.getAXState({ emit: false, disableDiffing: true });
  const check = (name, pass) => { if (!pass) throw new Error(name); checks.push(name); };
  const click = async text => {
    const lines = (await snapshot()).split('\n').filter(line => /^\s*\d+ /.test(line) && line.includes(text));
    if (lines.length !== 1) throw new Error(`${text}: ${lines.length} native targets`);
    await app.click(Number(lines[0].trim().split(' ')[0]));
    return snapshot();
  };
  await click('Description: Page draft,'); await app.paste('Persist across conversations'); await snapshot();
  await click('text entry area (settable) Ask anything'); await app.paste('Main draft survives conversation change'); await snapshot();
  let state = await click('link Description: New chat,');
  check('New draft hides previous browser', !state.includes('HTML content Page Two'));
  state = await click('toggle button Description: Open workspace tools');
  check('New draft owns separate tabs', state.includes('Tab list (1)') && !state.includes('Close Page Two'));
  state = await click('button Terminal,');
  if (state.includes('Choose a configured model')) {
    check('Unconfigured draft gets actionable error and Retry', state.includes('button Retry terminal') && !state.includes('Invalid session command'));
    await click('pop up button Description: Model: Configure models');
    await click('button Configure models');
    state = await click('toggle button Workspace E2E,');
    check('Failed preflight leaves model editable', !state.includes('Resolve the pending creation command'));
    await app.pressKey('Escape'); await snapshot();
    state = await click('button Retry terminal');
    check('Retry in place recovers after selecting model', state.includes('Terminal input') && !state.includes('button Retry terminal'));
  }
  check('Terminal available before first message', state.includes('Terminal input'));
  const marker = `NEW_SESSION_TERMINAL_${Date.now()}`;
  await app.paste(`printf '${marker}\\n' > terminal-new-session-e2e.txt`); await app.pressKey('Return'); await snapshot();
  check('First-message-free terminal runs real shell', (await readFile(join(fixture.workspace, 'terminal-new-session-e2e.txt'), 'utf8')).trim() === marker);
  state = await click('link Description: Initialize Workspace E2E — Workbench,');
  check('Main draft survives conversation switch', state.includes('Main draft survives conversation change'));
  if (!state.includes('tab (selected) Page Two,')) state = await click('tab (settable, integer) Page Two,');
  check('Native page survives conversation switch', state.includes('HTML content Page Two') && state.includes('Value: Persist across conversations'));
  await writeFile('/tmp/xopc-acceptance-native-final.png', await app.getScreenshot({ emit: false }));
  return checks;
}
