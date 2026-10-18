// Run from CUA REPL: runWorkspaceE2e(tab, viewport). Never launches a second browser.
// Only use the isolated URL printed by workspace-e2e-server.mjs.
export async function runWorkspaceE2e(tab, viewport) {
  const p = tab.playwright;
  const results = [];
  const assert = (name, passed) => { if (!passed) throw new Error(name); results.push(name); };
  const button = name => p.getByRole('button', { name, exact: true });
  const workspace = () => p.getByRole('complementary', { name: 'Files and side chats', exact: true });
  const side = () => p.getByRole('complementary', { name: 'Side chat', exact: true });
  const select = name => p.getByRole('tab', { name: name === 'report.md' ? /^report\.md(?: Unsaved)?$/ : name, exact: true });
  await p.getByRole('heading', { name: 'Initialize Workspace E2E', exact: true }).waitFor({ state: 'visible' });
  await button('Open workspace tools').click();
  await button('Files').click();
  await button('report.md').click();
  await p.getByRole('heading', { name: 'Workspace E2E', exact: true }).waitFor({ state: 'visible' });
  assert('Markdown rendered', await select('report.md').getAttribute('aria-selected') === 'true');
  assert('Main conversation remains visible', await p.getByRole('main').isVisible());
  await button('Edit').click();
  await tab.getAXState({ emit: false });
  await p.getByRole('tabpanel').getByRole('textbox').click();
  await p.getByRole('tabpanel').getByRole('textbox').fill('# Workspace E2E\n\nSaved through reusable CUA suite.\n');
  await select('Files').click();
  await button('example.json').click();
  await p.getByRole('tabpanel').getByText('42', { exact: true }).waitFor({ state: 'visible' });
  assert('JSON rendered', (await p.getByRole('tabpanel').innerText()).includes('42'));
  await tab.back();
  assert('Back restores Files', await select('Files').getAttribute('aria-selected') === 'true');
  await button('report.md').click();
  assert('File tabs deduplicate', await p.getByRole('tab').count() === 3);
  assert('Editor draft survives switch', (await p.getByRole('tabpanel').getByRole('textbox').innerText()).includes('Saved through reusable CUA suite.'));
  await button('Reference in main chat').click();
  await button('Remove: report.md').waitFor({ state: 'visible' });
  assert('Reference is attached without sending', await button('Remove: report.md').isVisible());
  await button('Remove: report.md').click();
  await button('New tab').click();
  assert('Tools homepage', await p.getByRole('heading', { name: 'Tools', exact: true }).isVisible());
  await button('Side chat').click();
  await p.getByRole('textbox', { name: 'Type a message…', exact: true }).fill('E2E draft');
  assert('Sidechat replaces home tab', await p.getByRole('tab').count() === 4);
  await select('report.md').click();
  await select('Side chat').click();
  assert('Sidechat draft retained', (await p.getByRole('textbox', { name: 'Type a message…', exact: true }).innerText()).includes('E2E draft'));
  await p.getByRole('textbox', { name: 'Type a message…', exact: true }).fill('E2E_SEND');
  await side().getByRole('button', { name: 'Send', exact: true }).click();
  await side().getByText('E2E_REPLY local model completed.', { exact: true }).waitFor({ state: 'visible' });
  assert('Real streamed Sidechat response', (await side().innerText()).includes('E2E_REPLY local model completed.'));
  await p.getByRole('textbox', { name: 'Type a message…', exact: true }).fill('E2E_HOLD');
  await side().getByRole('button', { name: 'Send', exact: true }).click();
  await button('Abort').waitFor({ state: 'visible' });
  await select('report.md').click();
  assert('Inactive running indicator', await select('Side chat Running').getAttribute('aria-selected') === 'false');
  await select('Side chat Running').click();
  await button('Abort').click();
  await select('Side chat').waitFor({ state: 'visible' });
  assert('Stop returns idle', !await button('Abort').isVisible());
  await button('Collapse workspace').click();
  await button('Open workspace tools').click();
  await button('Files').click();
  assert('Collapse retains all content tabs plus tools', await p.getByRole('tab').count() === 5);
  await select('report.md').click();
  assert('Tab strip selects file', await select('report.md').getAttribute('aria-selected') === 'true');
  await select('report.md').press('Home');
  await select('Files').press('Enter');
  assert('Keyboard tab navigation', await select('Files').getAttribute('aria-selected') === 'true');
  await button('diagram.svg').click();
  await button('Zoom in').click();
  assert('Image zoom', await button('115%').isVisible());
  await button('Expand workspace').click();
  if (!await p.getByRole('separator', { name: 'Resize file tree', exact: true }).isVisible()) await button('Toggle file tree').click();
  assert('Expanded inline tree', await p.getByRole('separator', { name: 'Resize file tree', exact: true }).isVisible());
  await button('Restore workspace').click();
  if (viewport) {
    try {
      await viewport.set({ width: 375, height: 812 });
      const bounds = await workspace().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right }; });
      assert('375px panel fits', bounds.x >= 0 && bounds.right <= 376);
      await button('Toggle file tree').click();
      assert('375px overlay tree', await button('Close file tree').isVisible());
      await tab.pressKey(null, 'Escape');
      await button('Back to chat').click();
      await workspace().waitFor({ state: 'hidden' });
      assert('375px returns to main chat', await p.getByRole('main').isVisible());
    } finally { await viewport.reset(); }
  }
  return results;
}
