import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

describe('build-electron-with-retry', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function runBuild(failures: number, error: string, args = ['--linux', 'appimage', '--arm64']) {
    const root = mkdtempSync(join(tmpdir(), 'xopc-electron-retry-'));
    roots.push(root);
    writeFileSync(
      join(root, 'node'),
      `#!/usr/bin/env bash
set -euo pipefail
state="$XOPC_RETRY_TEST_ROOT"
count=0
if [[ -f "$state/count" ]]; then count="$(cat "$state/count")"; fi
count=$((count + 1))
echo "$count" > "$state/count"
printf '%s\\n' "$@" > "$state/args"
if (( count <= XOPC_RETRY_TEST_FAILURES )); then
  echo "$XOPC_RETRY_TEST_ERROR" >&2
  exit 23
fi
echo 'Packaging complete'
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(root, 'sleep'),
      '#!/usr/bin/env bash\necho "$1" >> "$XOPC_RETRY_TEST_ROOT/delays"\n',
      { mode: 0o755 },
    );

    const result = spawnSync('bash', ['scripts/build-electron-with-retry.sh', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${root}${delimiter}${process.env.PATH}`,
        XOPC_RETRY_TEST_ROOT: root,
        XOPC_RETRY_TEST_FAILURES: String(failures),
        XOPC_RETRY_TEST_ERROR: error,
      },
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    return {
      ...result,
      attempts: Number(readFileSync(join(root, 'count'), 'utf8')),
      args: readFileSync(join(root, 'args'), 'utf8').trim().split('\n'),
      delays: existsSync(join(root, 'delays'))
        ? readFileSync(join(root, 'delays'), 'utf8').trim().split('\n')
        : [],
    };
  }

  it('builds once on success and forwards each argument intact', () => {
    const args = ['--linux', 'appimage', '--arm64', '--config.productName=Test App'];
    const result = runBuild(0, '', args);
    expect(result.status).toBe(0);
    expect(result.attempts).toBe(1);
    expect(result.delays).toEqual([]);
    expect(result.args).toEqual(['scripts/electron-builder.mjs', ...args]);
  });

  it.each([
    'ReadError: The server aborted pending request',
    'read ECONNRESET',
    'connect ETIMEDOUT',
    'getaddrinfo EAI_AGAIN',
    'socket hang up',
    '503 Slow Down',
    'code: serviceUnavailable',
  ])('retries a transient failure: %s', (error) => {
    const result = runBuild(1, error);
    expect(result.status).toBe(0);
    expect(result.attempts).toBe(2);
    expect(result.delays).toEqual(['30']);
    expect(result.stdout).toContain(error);
    expect(result.stdout).toContain('Packaging complete');
  });

  it('stops after three failed attempts and preserves the build exit code', () => {
    const result = runBuild(3, 'ReadError: The server aborted pending request');
    expect(result.status).toBe(23);
    expect(result.attempts).toBe(3);
    expect(result.delays).toEqual(['30', '60']);
    expect(result.stdout).toContain('failed after 3 attempts');
  });

  it('fails immediately for build errors', () => {
    const result = runBuild(3, 'Invalid configuration object');
    expect(result.status).toBe(23);
    expect(result.attempts).toBe(1);
    expect(result.delays).toEqual([]);
  });
});
