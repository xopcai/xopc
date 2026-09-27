import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = readFileSync(new URL('../entry/src/main/ets/view/SessionsView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  private chooseMenuAction('), source.indexOf('  private async shareSession('));
const compiled = ts.transpileModule(`class Handler { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Handler = new Function(`${compiled}; return Handler;`)();

function setup(status = '') {
  return Object.assign(new Handler(), {
    menuOpen: true, menuItem: { key: 'conversation', status }, pendingMenuAction: '',
    sessions: { busy: false, act: vi.fn(), scheduleDelete: vi.fn(), select: vi.fn() },
    renameItem: vi.fn(), shareSession: vi.fn(),
  });
}

describe('session long-press menu', () => {
  it('uses accessible themed rows instead of the compressed system action sheet', () => {
    expect(source).not.toContain('showActionSheet');
    expect(source).toContain('constraintSize({ minHeight: 52 })');
    expect(source).toContain("action === 'delete' ? this.colors.danger : this.colors.foreground");
    expect(source).toContain(".id('session-menu-cancel')");
    expect(source).toContain('onDisappear: (): void => { this.finishMenuDismiss(); }');
    expect(source).toContain("Column().id('session-menu-sheet-host').width('100%').height(0)\n          .bindSheet($$this.menuOpen");
    expect(source).toContain("Column().id('session-rename-sheet-host').width('100%').height(0)\n          .bindSheet($$this.renameOpen");
    expect(source).not.toMatch(/\.bindSheet\(\$\$this\.menuOpen[\s\S]*?\}\)\s*\.bindSheet/);
  });
  it.each(['share', 'rename', 'pin', 'archive', 'select', 'delete'])('dispatches %s once after dismissal', (action) => {
    const view = setup('pinned');
    view.chooseMenuAction(action);
    expect(view.menuOpen).toBe(false);
    expect(view.shareSession).not.toHaveBeenCalled();
    expect(view.renameItem).not.toHaveBeenCalled();
    expect(view.sessions.act).not.toHaveBeenCalled();
    view.chooseMenuAction('delete');
    view.finishMenuDismiss();
    view.finishMenuDismiss();
    const calls = [view.shareSession, view.renameItem, view.sessions.act, view.sessions.select, view.sessions.scheduleDelete];
    expect(calls.reduce((sum, fn) => sum + fn.mock.calls.length, 0)).toBe(1);
    if (action === 'pin') expect(view.sessions.act).toHaveBeenCalledWith([{ key: 'conversation', status: 'pinned' }], 'unpin');
    if (action === 'delete') expect(view.sessions.scheduleDelete).toHaveBeenCalledWith('conversation');
  });
  it('does nothing on cancellation or when a mutation is already running', () => {
    const view = setup();
    view.finishMenuDismiss();
    expect(view.sessions.act).not.toHaveBeenCalled();
    const busy = setup(); busy.sessions.busy = true;
    busy.chooseMenuAction('delete'); busy.finishMenuDismiss();
    expect(busy.sessions.scheduleDelete).not.toHaveBeenCalled();
  });
});
