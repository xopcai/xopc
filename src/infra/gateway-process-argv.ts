function normalizeProcArg(arg: string): string {
  return arg.trim().replaceAll('\\', '/').toLowerCase();
}

export function parseProcCmdline(raw: string): string[] {
  return raw
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isGatewayArgv(args: string[], opts?: { allowGatewayBinary?: boolean }): boolean {
  const normalized = args.map(normalizeProcArg);
  if (!normalized.includes('gateway')) {
    return false;
  }

  const entryCandidates = [
    'dist/cli/index.js',
    'dist/src/cli/index.js',
    'dist/index.js',
    'xopc.mjs',
    'scripts/run-node.mjs',
    'src/cli/index.ts',
  ];
  if (normalized.some((arg) => entryCandidates.some((entry) => arg.endsWith(entry)))) {
    return true;
  }

  const exeCandidates = normalized.map((arg) => arg.replace(/\.(bat|cmd|exe)$/i, ''));
  if (
    exeCandidates.some(
      (exe) =>
        exe.endsWith('/xopc') ||
        exe === 'xopc' ||
        (opts?.allowGatewayBinary === true && exe.endsWith('/xopc-gateway')),
    )
  ) {
    return true;
  }

  return false;
}
