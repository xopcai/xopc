export type VerificationCommandKind = 'check' | 'diff-review';

/** Recognize direct check invocations, never keywords inside arbitrary shell code. */
export function classifyVerificationCommand(command: string): VerificationCommandKind | undefined {
  if (/[\n\r;&|<>`$]/.test(command)) return undefined;
  const tokens = command.match(/"[^"\\]*"|'[^'\\]*'|[^\s"']+/g) ?? [];
  if (tokens.join(' ').replace(/\s/g, '') !== command.replace(/\s/g, '')) return undefined;
  const args = tokens.map((token) => token.replace(/^(['"])(.*)\1$/, '$2'));
  const executable = args.shift();
  if (!executable) return undefined;
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(executable)) {
    while (args[0] === '-C' || args[0] === '--dir' || args[0] === '--prefix') args.splice(0, 2);
    if (args[0] === 'exec') return classifyVerificationCommand(args.slice(1).join(' '));
    if (args[0] === 'run') args.shift();
    const script = args.shift() ?? '';
    return /^(test|typecheck|type-check|lint|build)(:[\w-]+)*$/.test(script)
      && !args.some((arg) => ['--help', '-h', '--version', '-v', '--list', '--listTests', '--dry-run', '--watch'].includes(arg))
      ? 'check' : undefined;
  }
  if (executable === 'node' && args[0] === '--test') {
    return args.some((arg) => /^(--help|--version|--test-only|--watch)(=|$)/.test(arg)) ? undefined : 'check';
  }
  if (['vitest', 'jest', 'pytest', 'tsc', 'mocha'].includes(executable)) {
    if (args.some((arg) => /^(--help|-h|--version|-v|--list|--listTests|--collect-only|--watch|-w)$/.test(arg))) return undefined;
    if (executable === 'vitest' && args[0] !== 'run') return undefined;
    return 'check';
  }
  if ((executable === 'go' && args[0] === 'test')
    || (executable === 'cargo' && ['test', 'check', 'clippy'].includes(args[0] ?? ''))
    || (executable === 'python' && args[0] === '-m' && args[1] === 'pytest')) {
    return args.some((arg) => /^(--help|--version|--collect-only|--no-run)$/.test(arg)) ? undefined : 'check';
  }
  return undefined;
}
