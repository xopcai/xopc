import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  buildFilePathClassifierContext,
  classifyFileLocation,
  fileRefSessionKeysMatch,
  resolveFileReferenceCandidate,
} from '../file-path-classifier.js';

describe('fileRefSessionKeysMatch', () => {
  it('treats empty registered and query keys as equal', () => {
    expect(fileRefSessionKeysMatch(undefined, '')).toBe(true);
    expect(fileRefSessionKeysMatch('', undefined)).toBe(true);
    expect(fileRefSessionKeysMatch('  ', '')).toBe(true);
  });

  it('requires exact match when either side is non-empty', () => {
    expect(fileRefSessionKeysMatch('main:webchat', 'main:webchat')).toBe(true);
    expect(fileRefSessionKeysMatch('main:webchat', '')).toBe(false);
    expect(fileRefSessionKeysMatch('', 'main:webchat')).toBe(false);
  });
});

describe('classifyFileLocation', () => {
  let root = '';
  let workspace = '';
  let profile = '';
  let skills = '';
  let stateDir = '';

  beforeEach(async () => {
    root = join(tmpdir(), `xopc-classifier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(root, { recursive: true });
    workspace = join(root, 'workspace');
    profile = join(root, 'agents', 'main', 'profile');
    skills = join(root, 'skills');
    stateDir = root;
    await mkdir(workspace, { recursive: true });
    await mkdir(profile, { recursive: true });
    await mkdir(join(skills, 'demo'), { recursive: true });
    await writeFile(join(workspace, 'notes.md'), '# notes\n');
    await writeFile(join(profile, 'IDENTITY.md'), '# id\n');
    await writeFile(join(skills, 'demo', 'SKILL.md'), '# skill\n');
  });

  const ctx = () => ({
    workspaceRoot: workspace,
    profileMarkdownRoot: profile,
    stateDir,
    skillsDir: skills,
    configFilePath: join(stateDir, 'xopc.json'),
    agentsHomeDir: join(stateDir, 'agents'),
    sessionsDir: join(stateDir, 'agents', 'main', 'sessions'),
    agentId: 'main',
  });

  it('classifies workspace files', () => {
    expect(classifyFileLocation(join(workspace, 'notes.md'), ctx())).toEqual({ scope: 'workspace' });
  });

  it('classifies agent profile files', () => {
    expect(classifyFileLocation(join(profile, 'IDENTITY.md'), ctx())).toEqual({
      scope: 'agent-profile',
      locationKind: 'agent-profile',
      manageRoute: '/settings/agents',
    });
  });

  it('classifies skills tree as xopc-skills', () => {
    expect(classifyFileLocation(join(skills, 'demo', 'SKILL.md'), ctx())).toEqual({
      scope: 'external',
      locationKind: 'xopc-skills',
      manageRoute: '/settings/skills',
    });
  });

  it('classifies arbitrary host paths', () => {
    expect(classifyFileLocation('/tmp/outside-xopc/report.pdf', ctx())).toEqual({
      scope: 'external',
      locationKind: 'host',
    });
  });
});

describe('resolveFileReferenceCandidate', () => {
  it('falls back bare IDENTITY.md to profile when missing in workspace', async () => {
    const root = join(tmpdir(), `xopc-resolve-${Date.now()}`);
    const workspace = join(root, 'ws');
    const profile = join(root, 'agents', 'a', 'profile');
    await mkdir(workspace, { recursive: true });
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, 'IDENTITY.md'), 'ok');

    const cfg = { agents: { defaults: {}, list: [{ id: 'a', default: true }] } } as Config;
    const built = buildFilePathClassifierContext(cfg, 'a:webchat:default:dm:1');
    const ctx = {
      ...built,
      workspaceRoot: workspace,
      profileMarkdownRoot: profile,
      stateDir: root,
      skillsDir: join(root, 'skills'),
      agentsHomeDir: join(root, 'agents'),
      sessionsDir: join(root, 'agents', 'a', 'sessions'),
    };

    const { candidate, invalid } = await resolveFileReferenceCandidate('IDENTITY.md', workspace, ctx);
    expect(invalid).toBe(false);
    expect(candidate).toBe(join(profile, 'IDENTITY.md'));
  });
});
