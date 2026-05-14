/**
 * Drift guard between `command-manifest.ts` (the static help text rendered by
 * the `bin.ts` short-circuit) and the actual commander program (rendered by
 * the loadAll fallback path). If a command is added to / removed from the
 * registry without updating the manifest, `xopc --help` would silently lie.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Command, Help } from 'commander';

import {
  ROOT_COMMAND_DESCRIPTION,
  ROOT_HELP_COMMANDS,
  ROOT_HELP_OPTIONS,
} from '../command-manifest.js';
import { loadAllCommands } from '../command-loaders.js';
import { createDefaultContext } from '../registry.js';
import pkg from '../../../package.json' with { type: 'json' };

interface CommandEntry {
  name: string;
  description: string;
}

interface OptionEntry {
  flags: string;
  description: string;
}

async function buildFullProgram(): Promise<Command> {
  const program = new Command()
    .name('xopc')
    .description(ROOT_COMMAND_DESCRIPTION)
    .version(pkg.version)
    .option('--verbose', 'Enable verbose logging', false)
    .option('--config <path>', 'Config file path')
    .option('--workspace <path>', 'Workspace directory');
  const ctx = createDefaultContext([], {});
  await loadAllCommands(program, ctx);
  return program;
}

function commanderCommandEntries(program: Command, helper: Help): CommandEntry[] {
  return helper.visibleCommands(program).map((cmd) => ({
    name: helper.subcommandTerm(cmd),
    description: helper.subcommandDescription(cmd),
  }));
}

function commanderOptionEntries(program: Command, helper: Help): OptionEntry[] {
  return helper.visibleOptions(program).map((opt) => ({
    flags: helper.optionTerm(opt),
    description: helper.optionDescription(opt),
  }));
}

function manifestCommandEntries(): CommandEntry[] {
  return ROOT_HELP_COMMANDS.map((c) => ({ name: c.name, description: c.description }));
}

function manifestOptionEntries(): OptionEntry[] {
  return ROOT_HELP_OPTIONS.map((o) => ({ flags: o.flags, description: o.description }));
}

function sortByName<T extends { name?: string; flags?: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const left = a.name ?? a.flags ?? '';
    const right = b.name ?? b.flags ?? '';
    return left.localeCompare(right);
  });
}

describe('command-manifest', () => {
  let program: Command;
  let helper: Help;

  beforeAll(async () => {
    program = await buildFullProgram();
    helper = new Help();
  }, 30_000);

  it('description matches ROOT_COMMAND_DESCRIPTION', () => {
    expect(program.description()).toBe(ROOT_COMMAND_DESCRIPTION);
  });

  it('command set matches commander (name + description)', () => {
    const fromCommander = sortByName(commanderCommandEntries(program, helper));
    const fromManifest = sortByName(manifestCommandEntries());
    expect(fromCommander).toEqual(fromManifest);
  });

  it('global options match commander (flags + description)', () => {
    const fromCommander = sortByName(
      commanderOptionEntries(program, helper).map((o) => ({ name: o.flags, ...o })),
    );
    const fromManifest = sortByName(
      manifestOptionEntries().map((o) => ({ name: o.flags, ...o })),
    );
    expect(fromCommander).toEqual(fromManifest);
  });
});
