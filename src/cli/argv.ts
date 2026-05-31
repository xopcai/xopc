const ROOT_VALUE_FLAGS = new Set(['--config', '--workspace']);

export function isHelpOrVersionInvocation(argv: string[]): boolean {
  return argv.some(
    (arg) =>
      arg === '--help' ||
      arg === '-h' ||
      arg === '--version' ||
      arg === '-V',
  );
}

export function isRootHelpInvocation(argv: string[]): boolean {
  const args = argv.slice(2).filter((arg) => arg !== '--');
  if (args.length === 0) {
    return false;
  }
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h' || args[0] === 'help')) {
    return true;
  }
  return false;
}

export function getPrimaryCommand(argv: string[]): string | null {
  const path = resolveCliCommandPath(argv);
  return path[0] ?? null;
}

/**
 * Walk argv and collect command tokens (skips global flags and `help` prefix).
 */
export function resolveCliCommandPath(argv: string[]): string[] {
  const path: string[] = [];
  let index = 2;

  while (index < argv.length) {
    const arg = argv[index];
    if (!arg) {
      index += 1;
      continue;
    }
    if (arg === '--') {
      break;
    }
    if (arg.startsWith('-')) {
      index += ROOT_VALUE_FLAGS.has(arg) ? 2 : 1;
      continue;
    }
    if (path.length === 0 && arg === 'help') {
      index += 1;
      continue;
    }
    path.push(arg);
    index += 1;
  }

  return path;
}
