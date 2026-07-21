import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  canonicalWorkDiscoveryRoot,
  probeWorkDiscoveryRoot,
  summarizeWorkContextSnapshot,
} from '../probe.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'xopc-work-discovery-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('work discovery probe', () => {
  it('collects useful text while excluding secrets, dependencies, and binaries', async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'README.md'), '# Current project\n\nFinish the onboarding flow.');
    await writeFile(join(root, 'src', 'index.ts'), 'export const ready = false;');
    await writeFile(join(root, '.env'), 'OPENAI_API_KEY=must-not-appear');
    await writeFile(join(root, 'credentials.json'), '{"token":"must-not-appear"}');
    await writeFile(join(root, 'node_modules', 'dependency.js'), 'must-not-appear');
    await writeFile(join(root, 'image.png'), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(root, 'brief.pdf'), Buffer.from('%PDF metadata only'));

    const snapshot = await probeWorkDiscoveryRoot(root);
    const paths = snapshot.documents.map((document) => document.relativePath);
    const text = snapshot.documents.map((document) => document.excerpt).join('\n');

    expect(paths).toContain('README.md');
    expect(paths).toContain(join('src', 'index.ts'));
    expect(paths).not.toContain('.env');
    expect(paths).not.toContain('credentials.json');
    expect(text).not.toContain('must-not-appear');
    expect(snapshot.structure.metadataOnlyFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'brief.pdf', kind: 'pdf' }),
      expect.objectContaining({ relativePath: 'image.png', kind: 'image' }),
    ]));
    expect(snapshot.limits.policyVersion).toBe(1);
  });

  it('does not follow symlinks outside the selected root', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await writeFile(join(outside, 'private.md'), 'outside secret');
    await symlink(join(outside, 'private.md'), join(root, 'linked.md'));

    const snapshot = await probeWorkDiscoveryRoot(root);

    expect(snapshot.documents).toEqual([]);
    expect(snapshot.structure.sampledPaths).not.toContain('linked.md');
  });

  it('requires an absolute directory and produces a safe summary', async () => {
    await expect(canonicalWorkDiscoveryRoot('relative/path')).rejects.toThrow('absolute');
    const root = await temporaryRoot();
    await writeFile(join(root, 'TODO.md'), '- continue');
    const snapshot = await probeWorkDiscoveryRoot(root);

    expect(summarizeWorkContextSnapshot(snapshot)).toMatchObject({
      documentCount: 1,
      contentBytes: expect.any(Number),
      changedPathCount: 0,
    });
  });
});
