import { spawn } from 'node:child_process';

import type { Component, KeybindingsManager, TUI } from '@earendil-works/pi-tui';
import { SelectList } from '@earendil-works/pi-tui';

import type { BashExecutionComponent } from './components/bash-execution.js';
import { formatKeyIds } from './format-tui-hotkeys.js';
import { selectListTheme } from './theme.js';

type LocalShellDeps = {
  chatLog: {
    addSystem: (line: string) => void;
    addBashExecution: (
      command: string,
      ui: TUI,
      excludeFromContext: boolean,
    ) => BashExecutionComponent;
  };
  tui: TUI & { requestRender: () => void; setFocus: (c: Component) => void };
  editor: Component;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  spawnCommand?: typeof spawn;
  getCwd?: () => string;
  env?: NodeJS.ProcessEnv;
  maxOutputChars?: number;
  keybindings?: KeybindingsManager;
  /** Pause stdout/stderr filtering before handing the terminal to a child (`stdio: 'inherit'`). */
  pauseStdioFilter?: () => void;
  resumeStdioFilter?: () => void;
  /** Wrap work while the TUI is stopped (full-screen subprocess). */
  runWithInheritedStdio?: (work: () => Promise<void>) => Promise<void>;
  onComplete?: (entry: {
    command: string;
    output?: string;
    exitCode?: number | null;
    signal?: string | null;
    excludeFromContext: boolean;
    truncated?: boolean;
  }) => void | Promise<void>;
};

export function formatLocalShellConsentHint(keybindings?: KeybindingsManager): string {
  const confirm = keybindings
    ? formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true })
    : 'Enter';
  const cancel = keybindings
    ? formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true })
    : 'Esc';
  return `↑/↓ + ${confirm} to choose, ${cancel} to cancel.`;
}

/** `!command` runs on the local machine (gated by in-session consent). `!!command` uses inherited stdio. */
export function createLocalShellRunner(deps: LocalShellDeps) {
  let localExecAsked = false;
  let localExecAllowed = false;
  const spawnCommand = deps.spawnCommand ?? spawn;
  const getCwd = deps.getCwd ?? (() => process.cwd());
  const env = deps.env ?? process.env;
  const maxChars = deps.maxOutputChars ?? 40_000;

  const ensureLocalExecAllowed = async (): Promise<boolean> => {
    if (localExecAllowed) {
      return true;
    }
    if (localExecAsked) {
      return false;
    }
    localExecAsked = true;

    return await new Promise<boolean>((resolve) => {
      deps.chatLog.addSystem('Allow local shell commands for this session?');
      deps.chatLog.addSystem(
        'Runs on YOUR machine (not the gateway); may delete files or expose secrets.',
      );
      deps.chatLog.addSystem(formatLocalShellConsentHint(deps.keybindings));
      const selector = new SelectList(
        [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ],
        2,
        selectListTheme,
      );
      selector.onSelect = (item) => {
        deps.closeOverlay();
        if (item.value === 'yes') {
          localExecAllowed = true;
          deps.chatLog.addSystem('local shell: enabled for this session');
          resolve(true);
        } else {
          deps.chatLog.addSystem('local shell: not enabled');
          resolve(false);
        }
        deps.tui.requestRender();
      };
      selector.onCancel = () => {
        deps.closeOverlay();
        deps.chatLog.addSystem('local shell: cancelled');
        deps.tui.requestRender();
        resolve(false);
      };
      deps.openOverlay(selector);
      deps.tui.requestRender();
    });
  };

  const runLocalShellLine = async (line: string) => {
    let cmd = line.slice(1);
    if (cmd === '') {
      return;
    }

    let inheritStdio = false;
    if (cmd.startsWith('!')) {
      inheritStdio = true;
      cmd = cmd.slice(1);
      if (cmd === '') {
        deps.chatLog.addSystem('[local] !! requires a command (e.g. !!vim file)');
        deps.tui.requestRender();
        return;
      }
    }

    if (localExecAsked && !localExecAllowed) {
      deps.chatLog.addSystem('local shell: not enabled for this session');
      deps.tui.requestRender();
      return;
    }

    const allowed = await ensureLocalExecAllowed();
    if (!allowed) {
      return;
    }

    if (
      inheritStdio &&
      deps.runWithInheritedStdio &&
      deps.pauseStdioFilter &&
      deps.resumeStdioFilter
    ) {
      deps.pauseStdioFilter();
      try {
        await deps.runWithInheritedStdio(async () => {
          await new Promise<void>((resolve, reject) => {
            const child = spawnCommand(cmd, {
              shell: true,
              cwd: getCwd(),
              env: { ...env, XOPC_SHELL: 'tui-local' },
              stdio: 'inherit',
            });
            child.on('close', async (code, signal) => {
              deps.chatLog.addSystem(
                `[local] !! $ ${cmd} — exit ${code ?? '?'}${signal ? ` (signal ${signal})` : ''} (excluded from agent context)`,
              );
              await deps.onComplete?.({
                command: cmd,
                output: '',
                exitCode: code,
                signal,
                excludeFromContext: true,
              });
              resolve();
            });
            child.on('error', (err) => {
              deps.chatLog.addSystem(`[local] error: ${String(err)}`);
              reject(err);
            });
          });
        });
      } catch {
        // logged above
      } finally {
        deps.resumeStdioFilter();
        deps.tui.setFocus(deps.editor);
        deps.tui.requestRender();
      }
      return;
    }

    if (inheritStdio && !deps.runWithInheritedStdio) {
      deps.chatLog.addSystem('[local] inherited stdio requires full TUI wiring; use single ! instead.');
      deps.tui.requestRender();
      return;
    }

    const bashBlock = deps.chatLog.addBashExecution(cmd, deps.tui, false);
    deps.tui.requestRender();

    await new Promise<void>((resolve) => {
      const child = spawnCommand(cmd, {
        shell: true,
        cwd: getCwd(),
        env: { ...env, XOPC_SHELL: 'tui-local' },
      });

      let totalChars = 0;
      let output = '';
      let truncated = false;
      const appendCapped = (chunk: string) => {
        if (totalChars >= maxChars) {
          truncated = true;
          return;
        }
        const slice = chunk.slice(0, maxChars - totalChars);
        totalChars += slice.length;
        output += slice;
        if (slice.length < chunk.length) {
          truncated = true;
        }
        bashBlock.appendOutput(slice);
        deps.tui.requestRender();
      };

      child.stdout?.on('data', (buf) => appendCapped(buf.toString('utf8')));
      child.stderr?.on('data', (buf) => appendCapped(buf.toString('utf8')));

      child.on('close', async (code, signal) => {
        await deps.onComplete?.({
          command: cmd,
          output,
          exitCode: code,
          signal,
          excludeFromContext: false,
          truncated,
        });
        bashBlock.setComplete(code, signal);
        deps.tui.requestRender();
        resolve();
      });

      child.on('error', async (err) => {
        await deps.onComplete?.({
          command: cmd,
          output: String(err),
          exitCode: null,
          signal: null,
          excludeFromContext: false,
        });
        bashBlock.setError(String(err));
        deps.tui.requestRender();
        resolve();
      });
    });
  };

  return { runLocalShellLine };
}
