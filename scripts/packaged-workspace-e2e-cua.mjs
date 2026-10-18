// Native UI checks against the unmodified installed app, without acceptance-only menus.
import { readFile, writeFile } from 'node:fs/promises';

export async function runPackagedWorkspaceMotion(app) {
  const checks = [];
  const snapshot = () => app.getAXState({ emit: false, disableDiffing: true });
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const click = async text => {
    const lines = (await snapshot()).split('\n').filter(line => /^\s*\d+ /.test(line) && line.includes(text));
    if (lines.length !== 1) throw new Error(`${text}: ${lines.length} native targets`);
    await app.click(Number(lines[0].trim().split(' ')[0]));
    return snapshot();
  };
  let state = await click('tab (settable, integer) Page Two,');
  await click('Description: Page draft,'); await app.paste('Packaged retained form'); await snapshot();
  for (let cycle = 1; cycle <= 4; cycle++) {
    await click('tab (settable, integer) report.md,');
    await click('tab (settable, integer) Side chat,');
    state = await click('tab (settable, integer) Page Two,');
    check(`Installed mixed-tab motion ${cycle}`, state.includes('HTML content Page Two') && state.includes('Value: Packaged retained form'));
  }
  await click('toggle button Description: Open workspace tools');
  state = await click('button Terminal,');
  check('Installed terminal enter motion', state.includes('Terminal input'));
  state = await click('tab (settable, integer) Page Two,');
  check('Installed native viewport tracks terminal', state.includes('HTML content Page Two') && state.includes('Terminal input'));
  state = await click('button Hide terminal');
  check('Installed terminal exit preserves page', state.includes('HTML content Page Two') && !state.includes('Terminal input'));
  state = await click('button Expand workspace');
  check('Installed expand preserves native page', state.includes('HTML content Page Two') && state.includes('button Restore workspace'));
  state = await click('button Restore workspace');
  check('Installed restore preserves native page', state.includes('HTML content Page Two') && state.includes('button Expand workspace'));
  state = await click('button Description: Collapse workspace');
  check('Installed collapse hides native page', !state.includes('HTML content Page Two'));
  await click('toggle button Description: Open workspace tools');
  state = await click('tab (settable, integer) Page Two,');
  check('Installed reopen preserves form', state.includes('Value: Packaged retained form'));
  state = await click('toggle button Description: Toggle file tree,');
  check('Installed file tree toggles inside workspace', state.includes('Filter files') || state.includes('Close file tree'));
  state = await click('toggle button Description: Toggle file tree,');
  check('Installed browser tree toggle remains reachable', !state.includes('button Close file tree') && state.includes('HTML content Page Two'));
  await click('tab (settable, integer) report.md,');
  state = await click('toggle button Description: Toggle file tree,');
  check('Installed file tree opens below preview toolbar', state.includes('button Close file tree'));
  state = await click('toggle button Description: Toggle file tree,');
  check('Installed preview tree toggle remains reachable', !state.includes('button Close file tree'));
  await click('tab (settable, integer) Page Two,');
  await click('pop up button Tab list'); await app.pressKey('Home'); await app.pressKey('End');
  state = await snapshot();
  check('Installed tab list keyboard navigation', state.includes('Open tabs'));
  await app.pressKey('Escape');
  state = await snapshot();
  check('Installed menu dismissal restores guest', state.includes('HTML content Page Two'));
  for (const label of ['Installed native window zoom', 'Installed native window restore']) {
    const zoom = (await snapshot()).split('\n').find(line => /^\s*\d+ full screen button.*Secondary Actions: zoom the window/.test(line));
    if (!zoom) throw new Error('Native window zoom action unavailable');
    await app.performSecondaryAction(Number(zoom.trim().split(' ')[0]), 'zoom the window');
    state = await snapshot();
    check(label, state.includes('HTML content Page Two') && state.includes('Value: Packaged retained form'));
  }
  await writeFile('/tmp/xopc-packaged-native-final.png', await app.getScreenshot({ emit: false }));
  await writeFile('/tmp/xopc-packaged-motion-results.json', JSON.stringify(checks, null, 2));
  return checks;
}

export async function verifyPackagedRelaunch(app) {
  const fixture = JSON.parse(await readFile('/tmp/xopc-packaged-e2e.json', 'utf8'));
  let state = await app.getAXState({ emit: false, disableDiffing: true });
  const checks = [];
  if (!state.includes('heading Initialize Workspace E2E')) {
    const lines = state.split('\n').filter(line => /^\s*\d+ link Description: Initialize Workspace E2E/.test(line));
    if (lines.length !== 1) throw new Error('Saved conversation missing after packaged relaunch');
    await app.click(Number(lines[0].trim().split(' ')[0]));
    state = await app.getAXState({ emit: false, disableDiffing: true });
  }
  if (!state.includes('heading Initialize Workspace E2E')) throw new Error('Saved conversation did not reopen');
  checks.push('Installed relaunch restores conversation');
  if (!state.includes('Native E2E file saved.')) {
    const content = await readFile(`${fixture.workspace}/report.md`, 'utf8');
    if (!content.includes('Native E2E file saved.')) throw new Error('Saved file missing after packaged relaunch');
  }
  checks.push('Installed relaunch retains saved file');
  if (!state.includes('E2E_REPLY local model completed.')) throw new Error('Transcript missing after packaged relaunch');
  checks.push('Installed relaunch retains transcript');
  await writeFile('/tmp/xopc-packaged-relaunch-results.json', JSON.stringify(checks, null, 2));
  return checks;
}

export async function runPackagedRelaunchTools(app, site) {
  const fixture = JSON.parse(await readFile('/tmp/xopc-packaged-e2e.json', 'utf8'));
  const checks = [];
  const snapshot = () => app.getAXState({ emit: false, disableDiffing: true });
  const check = (label, condition) => { if (!condition) throw new Error(label); checks.push(label); };
  const click = async text => {
    const full = await snapshot();
    const target = text === 'button Send' ? full.slice(full.indexOf('container Files and side chats')) : full;
    const lines = target.split('\n').filter(line => /^\s*\d+ /.test(line) && line.includes(text));
    if (lines.length !== 1) throw new Error(`${text}: ${lines.length} native targets`);
    await app.click(Number(lines[0].trim().split(' ')[0]));
    return snapshot();
  };
  let state = await snapshot();
  check('Installed relaunch restores main composer draft', state.includes('Main draft survives conversation change'));
  state = await click('toggle button Description: Open workspace tools');
  check('Relaunch Tools exposes all four native tools', ['button Files', 'button Side chat', 'button Browser', 'button Terminal'].every(text => state.includes(text)));
  await click('button Files'); state = await click('button report.md');
  check('Relaunch file preview renders saved content', state.includes('Native E2E file saved.'));
  await click('button New tab'); await click('button Browser');
  await click('Search or enter a URL'); await app.paste(site + '/two'); await app.pressKey('Return');
  state = await snapshot();
  check('Relaunch native browser creates and renders page', state.includes('HTML content Page Two') && state.includes('electronAPI=undefined'));
  await click('button New tab'); await click('button Side chat');
  await click('text entry area (settable) Type a message…'); await app.paste('E2E_SEND_AFTER_RESTART');
  await click('button Send'); state = await snapshot();
  check('Relaunch Sidechat streams a real response', state.includes('E2E_SEND_AFTER_RESTART') && state.includes('E2E_REPLY local model completed.'));
  await click('toggle button Description: Open workspace tools'); state = await click('button Terminal,');
  check('Relaunch terminal mounts real PTY', state.includes('Terminal input'));
  const marker = `RELAUNCH_PTY_${Date.now()}`;
  await app.paste(`printf '${marker}\\n' > terminal-relaunch-e2e.txt`); await app.pressKey('Return'); await snapshot();
  check('Relaunch PTY executes in the conversation workspace', (await readFile(`${fixture.workspace}/terminal-relaunch-e2e.txt`, 'utf8')).trim() === marker);
  await click('button Hide terminal'); await click('tab (settable, integer) report.md,');
  state = await click('tab (settable, integer) Page Two,');
  check('Relaunch mixed tools switch back to native browser', state.includes('HTML content Page Two') && state.includes('Main draft survives conversation change'));
  await writeFile('/tmp/xopc-packaged-relaunch-final.png', await app.getScreenshot({ emit: false }));
  await writeFile('/tmp/xopc-packaged-relaunch-tools-results.json', JSON.stringify(checks, null, 2));
  return checks;
}
