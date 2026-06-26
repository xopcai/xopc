import { describe, expect, it } from 'vitest';

import { formatXopcTuiHotkeys } from '../format-tui-hotkeys.js';
import {
  createXopcTuiKeybindingsManager,
  XopcKeybindingsManager,
} from '../tui-keybindings-file.js';
import { formatTuiHelpText, getSlashCommands } from '../tui-commands.js';

describe('formatXopcTuiHotkeys', () => {
it('includes model cycle and session picker descriptions', () => {
    const km = createXopcTuiKeybindingsManager();
    const text = formatXopcTuiHotkeys(km);
    expect(text).toContain('Next model');
    expect(text).toContain('Session picker');
    expect(text).toContain('Show session tree');
    expect(text).toContain('Fork current session');
    expect(text).toContain('Queue message');
    expect(text).toContain('Restore queued');
    expect(text).toContain('Toggle session sort mode');
    expect(text).toContain('Rename selected session');
    expect(text).toContain('Save scoped model selection');
    expect(text).toContain('Move scoped model down');
  });

  it('includes extension shortcuts in a pi-style extension section', () => {
    const km = createXopcTuiKeybindingsManager();
    const text = formatXopcTuiHotkeys(km, [
      { key: 'ctrl+x', description: 'Run demo extension action' },
      { key: 'alt+shift+d' },
    ]);

    expect(text).toContain('Extensions:');
    expect(text).toContain('Ctrl+X — Run demo extension action');
    expect(text).toContain(
      `${process.platform === 'darwin' ? 'Option' : 'Alt'}+Shift+D — Extension shortcut`,
    );
  });

  it('uses resolved keybindings in slash command descriptions and help text', () => {
    const km = new XopcKeybindingsManager({
      'app.tools.expand': 'x',
      'app.session.resume': 's',
      'app.session.tree': 't',
      'app.session.fork': 'f',
      'app.model.cycleForward': 'm',
    });

    const commandDescriptions = getSlashCommands(true, km)
      .map((command) => command.description)
      .join('\n');
    expect(commandDescriptions).toContain('or X');
    expect(commandDescriptions).toContain('or S');
    expect(commandDescriptions).toContain('M cycling');

    const help = formatTuiHelpText(true, km);
    expect(help).toContain('X — Toggle tool output');
    expect(help).toContain('S — Session picker');
    expect(help).toContain('T — Session tree');
    expect(help).toContain('F — Fork current session');
    expect(help).toContain('/scoped-models — Limit M model cycle set');
    expect(help).toContain('use /reload');
  });

  it('includes extension slash commands in help without duplicating built-ins', () => {
    const help = formatTuiHelpText(true, createXopcTuiKeybindingsManager(), [
      { name: 'demo', description: 'Demo extension command' },
      { name: '/share', description: 'Conflicting extension command' },
    ]);

    expect(help).toContain('Extension commands:');
    expect(help).toContain('/demo — Demo extension command');
    expect(help.match(/\/share/g)?.length).toBe(1);
  });

  it('includes skill slash commands in a dedicated help section', () => {
    const help = formatTuiHelpText(
      true,
      createXopcTuiKeybindingsManager(),
      [],
      [
        { name: 'skill:review', description: 'Apply skill to the next turn' },
        { name: 'skill:tdd', description: 'Apply skill to the next turn' },
      ],
    );

    expect(help).toContain('Skill commands:');
    expect(help).toContain('/skill:review — Apply skill to the next turn');
    expect(help).toContain('/skill:tdd — Apply skill to the next turn');
  });

  it('includes workflow slash commands in a dedicated help section', () => {
    const help = formatTuiHelpText(
      true,
      createXopcTuiKeybindingsManager(),
      [],
      [],
      [
        { name: 'workflow:audit_repo', description: 'Run workflow' },
        { name: 'workflow:weekly_review', description: 'Run workflow' },
      ],
    );

    expect(help).toContain('Workflow commands:');
    expect(help).toContain('/workflow:audit_repo — Run workflow');
    expect(help).toContain('/workflow:weekly_review — Run workflow');
  });

  it('exposes pi-style reload command alias', () => {
    expect(getSlashCommands(true).some((command) => command.name === 'reload')).toBe(true);
  });

  it('exposes pi-style copy command', () => {
    expect(getSlashCommands(true).some((command) => command.name === 'copy')).toBe(true);
  });

  it('exposes pi-style name command', () => {
    expect(getSlashCommands(true).some((command) => command.name === 'name')).toBe(true);
  });

  it('exposes pi-style session command', () => {
    expect(getSlashCommands(true).some((command) => command.name === 'session')).toBe(true);
  });

  it('exposes pi-style quit command', () => {
    expect(getSlashCommands(true).some((command) => command.name === 'quit')).toBe(true);
  });
});
