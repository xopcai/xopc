import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverWorkCandidates } from '../candidate-discovery.js';

const cleanup: string[] = [];

async function tempHome(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'xopc-work-candidates-'));
  cleanup.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('discoverWorkCandidates', () => {
  it('finds and ranks repositories under common work roots', async () => {
    const home = await tempHome();
    const active = join(home, 'develop', 'active-project');
    const unknown = join(home, 'develop', 'random-folder');
    await mkdir(active, { recursive: true });
    await mkdir(unknown, { recursive: true });
    await writeFile(join(active, 'package.json'), '{"name":"active-project"}');
    execFileSync('git', ['init', active]);
    execFileSync('git', ['-C', active, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', active, 'config', 'user.name', 'Test']);
    execFileSync('git', ['-C', active, 'add', 'package.json']);
    execFileSync('git', ['-C', active, 'commit', '-m', 'Initial work']);

    const result = await discoverWorkCandidates({ homeDirectory: home, nowMs: Date.now() });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ displayName: 'active-project', projectKind: 'coding' });
    expect(result[0]!.score).toBeGreaterThan(50);
    expect(result[0]!.evidence).toContain('recent Git activity');
  });

  it('finds repositories one level below a grouping directory', async () => {
    const home = await tempHome();
    const nested = join(home, 'develop', 'github', 'nested-project');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'package.json'), '{"name":"nested-project"}');
    execFileSync('git', ['init', nested]);
    execFileSync('git', ['-C', nested, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', nested, 'config', 'user.name', 'Test']);
    execFileSync('git', ['-C', nested, 'add', 'package.json']);
    execFileSync('git', ['-C', nested, 'commit', '-m', 'Initial work']);

    const result = await discoverWorkCandidates({ homeDirectory: home, nowMs: Date.now() });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rootPath: await realpath(nested), displayName: 'nested-project' });
  });

  it('prefers an existing xopc project and deduplicates its common-root path', async () => {
    const home = await tempHome();
    const project = join(home, 'Projects', 'known-project');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'README.md'), '# Known project');

    const result = await discoverWorkCandidates({
      homeDirectory: home,
      existingProjects: [{ id: 'project-1', workspaceRoot: project }],
      nowMs: Date.now(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'project:project-1',
      source: 'existing_project',
      projectId: 'project-1',
    });
    expect(result[0]!.evidence).toContain('already connected to xopc');
  });

  it('discovers project folders on the desktop and in documents', async () => {
    const home = await tempHome();
    const documentProject = join(home, 'Documents', 'private-project');
    const desktopProject = join(home, 'Desktop', 'active-project');
    await mkdir(documentProject, { recursive: true });
    await mkdir(desktopProject, { recursive: true });
    await writeFile(join(documentProject, 'package.json'), '{"name":"private-project"}');
    await writeFile(join(desktopProject, 'pyproject.toml'), '[project]\nname="active-project"');

    const result = await discoverWorkCandidates({ homeDirectory: home });

    expect(result.map((candidate) => candidate.displayName).sort()).toEqual(['active-project', 'private-project']);
    expect(result.every((candidate) => candidate.source === 'personal_work_root')).toBe(true);
  });

  it('discovers recent general work folders in Downloads without reading the root as one project', async () => {
    const home = await tempHome();
    const briefFolder = join(home, 'Downloads', 'client-brief');
    await mkdir(briefFolder, { recursive: true });
    await writeFile(join(briefFolder, 'proposal.pdf'), 'metadata-only fixture');

    const result = await discoverWorkCandidates({ homeDirectory: home, nowMs: Date.now() });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ displayName: 'client-brief', source: 'personal_work_root', projectKind: 'general' });
    expect(result[0]!.rootPath).not.toBe(join(home, 'Downloads'));
  });

  it('honors Linux XDG user directory locations', async () => {
    const home = await tempHome();
    const xdgDesktop = join(home, 'Worksurface');
    const project = join(xdgDesktop, 'xdg-project');
    await mkdir(join(home, '.config'), { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(home, '.config', 'user-dirs.dirs'), 'XDG_DESKTOP_DIR="$HOME/Worksurface"\n');
    await writeFile(join(project, 'package.json'), '{"name":"xdg-project"}');

    const result = await discoverWorkCandidates({ homeDirectory: home, platform: 'linux' });

    expect(result.some((candidate) => candidate.displayName === 'xdg-project')).toBe(true);
  });

  it('includes Windows OneDrive redirected user directories', async () => {
    const home = await tempHome();
    const oneDrive = join(home, 'OneDrive');
    const project = join(oneDrive, 'Desktop', 'onedrive-project');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), '{"name":"onedrive-project"}');

    const result = await discoverWorkCandidates({
      homeDirectory: home,
      platform: 'win32',
      environment: { OneDrive: oneDrive },
    });

    expect(result.some((candidate) => candidate.displayName === 'onedrive-project')).toBe(true);
  });

  it('includes a previously approved general work folder without Git', async () => {
    const home = await tempHome();
    const approved = join(home, 'client-briefs');
    await mkdir(approved, { recursive: true });
    await writeFile(join(approved, 'README.md'), '# Client briefs');

    const result = await discoverWorkCandidates({
      homeDirectory: home,
      approvedDirectories: [{ id: 'source-1', rootPath: approved }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: 'approved_directory', displayName: 'client-briefs' });
  });
});
