import { describe, it, expect } from 'vitest';
import { validatePath, validateWritePath } from '../path-policy.js';

describe('validatePath', () => {
  it('allows normal workspace paths', () => {
    const result = validatePath('/Users/test/projects/myapp/src/index.ts');
    expect(result.allowed).toBe(true);
  });

  it('blocks /etc paths', () => {
    const result = validatePath('/etc/passwd');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked directory');
  });

  it('blocks /proc paths', () => {
    const result = validatePath('/proc/1/status');
    expect(result.allowed).toBe(false);
  });

  it('blocks /sys paths', () => {
    const result = validatePath('/sys/class/net');
    expect(result.allowed).toBe(false);
  });

  it('blocks /dev paths', () => {
    const result = validatePath('/dev/sda');
    expect(result.allowed).toBe(false);
  });

  it('blocks Docker socket path', () => {
    const result = validatePath('/var/run/docker.sock');
    expect(result.allowed).toBe(false);
  });

  it('blocks ~/.ssh paths', () => {
    const home = process.env.HOME || '/tmp';
    const result = validatePath(`${home}/.ssh/id_rsa`);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked directory');
  });

  it('blocks ~/.aws paths', () => {
    const home = process.env.HOME || '/tmp';
    const result = validatePath(`${home}/.aws/credentials`);
    expect(result.allowed).toBe(false);
  });

  it('blocks ~/.gnupg paths', () => {
    const home = process.env.HOME || '/tmp';
    const result = validatePath(`${home}/.gnupg/secring.gpg`);
    expect(result.allowed).toBe(false);
  });

  it('blocks filesystem root', () => {
    const result = validatePath('/');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('root');
  });

  it('blocks empty path', () => {
    const result = validatePath('');
    expect(result.allowed).toBe(false);
  });

  it('blocks macOS private/etc', () => {
    const result = validatePath('/private/etc/hosts');
    expect(result.allowed).toBe(false);
  });

  it('enforces allowedRoots when specified', () => {
    const result = validatePath('/home/user/other-project/file.ts', {
      allowedRoots: ['/home/user/myproject'],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('outside allowed roots');
  });

  it('allows paths inside allowedRoots', () => {
    const result = validatePath('/home/user/myproject/src/main.ts', {
      allowedRoots: ['/home/user/myproject'],
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks extra blocked paths', () => {
    const result = validatePath('/custom/sensitive/data.json', {
      extraBlockedPaths: ['/custom/sensitive'],
    });
    expect(result.allowed).toBe(false);
  });

  it('returns canonicalPath on success', () => {
    const result = validatePath('/tmp/test-file.txt');
    expect(result.allowed).toBe(true);
    expect(result.canonicalPath).toBeDefined();
  });
});

describe('validateWritePath', () => {
  it('blocks writing to .xopc/xopc.json', () => {
    const result = validateWritePath('/home/user/.xopc/xopc.json', '/home/user/workspace');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('protected config');
  });

  it('blocks writing to .env', () => {
    const result = validateWritePath('.env', '/home/user/workspace');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('protected config');
  });

  it('blocks writing to .env.local', () => {
    const result = validateWritePath('.env.local', '/home/user/workspace');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('protected config');
  });

  it('allows writing normal files', () => {
    const result = validateWritePath('src/main.ts', '/tmp/workspace');
    expect(result.allowed).toBe(true);
  });

  it('resolves relative paths under workspace', () => {
    const result = validateWritePath('src/index.ts', '/tmp/workspace');
    expect(result.allowed).toBe(true);
  });
});
