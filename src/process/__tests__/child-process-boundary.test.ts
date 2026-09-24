import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const allowed = new Set([
  'src/agent/coding/repository-instructions.ts',
  'src/agent/coding/workspace-revision.ts',
  'src/agent/context/workspace-seed.ts',
  'src/agent/mcp/mcp-stdio-transport.ts',
  'src/agent/skills/hub-pull.ts',
  'src/agent/tools/repository-search.ts',
  'src/agent/tools/review-workspace.ts',
  'src/browser/providers/browser-ext-install.ts',
  'src/browser/providers/playwright-install.ts',
  'src/cli/commands/extension-marketplace.ts',
  'src/cli/commands/extension-pack.ts',
  'src/daemon/launchd.ts',
  'src/daemon/schtasks.ts',
  'src/daemon/systemd.ts',
  'src/extensions/install.ts',
  'src/gateway/ports.ts',
  'src/gateway/respawn.ts',
  'src/gateway/workspace-ripgrep.ts',
  'src/infra/gateway-processes.ts',
  'src/infra/ports.ts',
  'src/infra/ssh-tunnel.ts',
  'src/infra/tailscale.ts',
  'src/projects/workspace-project.ts',
  'src/review/review-git.ts',
  'src/runtime-tools/archive.ts',
  'src/runtime-tools/command.ts',
  'src/storage/sqlite/connection.ts',
  'src/storage/sqlite/migrations/conversation-backup.ts',
  'src/storage/sqlite/migrations/conversation-windows-owners.ts',
  'src/tui/clipboard-image.ts',
  'src/tui/clipboard-text.ts',
  'src/tui/tui-fd-path.ts',
  'src/tui/tui-git-branch.ts',
  'src/tui/tui-local-shell.ts',
  'src/tui/tui-oauth-login.ts',
  'src/tui/tui.ts',
  'src/tunnel/frpc-extract.ts',
  'src/tunnel/frpc-process.ts',
  'src/voice/audio/normalize.ts',
  'src/work-discovery/candidate-discovery.ts',
  'src/work-discovery/probe.ts',
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

it('keeps new child process launches behind the process runtime boundary', async () => {
  const violations: string[] = [];
  for (const path of await sourceFiles(resolve(repositoryRoot, 'src'))) {
    const source = await readFile(path, 'utf8');
    if (!/^import\s+(?!type\b).*from ['"]node:child_process['"];?$/m.test(source)) continue;
    const name = relative(repositoryRoot, path);
    if (!name.startsWith('src/process/') && !allowed.has(name)) violations.push(name);
  }
  expect(violations).toEqual([]);
});
