import type { KeybindingsManager } from '@earendil-works/pi-tui';

import { formatKeyIds } from './format-tui-hotkeys.js';
import { formatModelLabel } from './tui-command-formatters.js';
import type { TuiStartupResources } from './tui-backend.js';
import type { TuiState } from './tui-types.js';

const DEFAULT_LIMIT = 6;

function keyLabel(
  keybindings: KeybindingsManager | undefined,
  id: Parameters<KeybindingsManager['getKeys']>[0],
  fallback: string,
): string {
  return keybindings ? formatKeyIds(keybindings, id, { capitalize: false }) : fallback;
}

function compactKeyLine(keybindings?: KeybindingsManager): string {
  const interrupt = keyLabel(keybindings, 'app.interrupt', 'escape');
  const clear = keyLabel(keybindings, 'app.clear', 'ctrl+c');
  const exit = keyLabel(keybindings, 'app.exit', 'ctrl+d');
  const tools = keyLabel(keybindings, 'app.tools.expand', 'ctrl+o');
  return `${interrupt} interrupt · ${clear}/${exit} clear/exit · / commands · ! bash · ${tools} tools`;
}

function formatResourceSection(
  title: string,
  values: readonly string[] | undefined,
  options: { expanded: boolean },
): string[] {
  const list = [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const lines = [`[${title}]`];
  if (list.length === 0) {
    lines.push('  none');
    return lines;
  }
  if (!options.expanded) {
    const visible = list.slice(0, DEFAULT_LIMIT);
    const suffix = list.length > visible.length ? `, ... ${list.length - visible.length} more` : '';
    lines.push(`  ${visible.join(', ')}${suffix}`);
    return lines;
  }
  const visible = list.slice(0, 30);
  for (const value of visible) {
    lines.push(`  ${value}`);
  }
  if (list.length > visible.length) {
    lines.push(`  ... ${list.length - visible.length} more`);
  }
  return lines;
}

export function formatTuiStartupText(input: {
  state: TuiState;
  isLocal: boolean;
  keybindings?: KeybindingsManager;
  resources?: TuiStartupResources;
  expanded?: boolean;
}): string {
  const expanded = input.expanded === true;
  const lines: string[] = [];

  if (expanded) {
    lines.push('xopc TUI', '');
    lines.push(`Session: ${input.state.currentSessionKey}`);
    lines.push(`Mode: ${input.isLocal ? 'local embedded' : 'gateway'}`);
    lines.push(`Model: ${formatModelLabel(input.state)}`);
    lines.push('');
  }

  lines.push(compactKeyLine(input.keybindings));
  lines.push('Press /start to show full startup help and loaded resources.');
  lines.push('');
  lines.push(
    'xopc can use skills, workflows, connectors, and project context. Ask it how to automate or connect services.',
  );

  if (expanded) {
    lines.push(
      '',
      'Ask xopc:',
      '  "what workflows are available?"',
      '  "use a connector to check issues or docs"',
      '  "what skills can help with this task?"',
    );
  }

  lines.push('');
  lines.push(...formatResourceSection('Context', input.resources?.context, { expanded }));
  lines.push('');
  lines.push(...formatResourceSection('Skills', input.resources?.skills, { expanded }));
  lines.push('');
  lines.push(...formatResourceSection('Workflows', input.resources?.workflows, { expanded }));
  lines.push('');
  lines.push(...formatResourceSection('Connectors', input.resources?.connectors, { expanded }));

  if (expanded) {
    lines.push(
      '',
      'Useful commands:',
      '  /help — Show all commands and shortcuts',
      '  /workflow list — List saved workflows',
      '  /models — List available models',
      '  /settings — Open TUI settings',
      '  /export — Export current session',
    );
  }

  return lines.join('\n');
}
