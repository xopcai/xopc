import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { runBootstrapMigrationsSync } from '../runner.js';

it.each([
  ['telegram', 'agent:main:telegram:personal:direct:1234', '1234'],
  ['weixin', 'agent:main:weixin:personal:direct:user@im.wechat', 'personal:direct:user@im.wechat'],
])('converts %s delivery configuration once with an original backup', (target, oldAddress, address) => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-conversation-config-'));
  try {
    const path = join(dir, 'xopc.json');
    const original = JSON.stringify({ gateway: { heartbeat: { enabled: true, intervalMs: 1800000, target, targetChatId: oldAddress } } });
    writeFileSync(path, original);
    expect(runBootstrapMigrationsSync(path).changed).toBe(true);
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe(original);
    expect(JSON.parse(readFileSync(path, 'utf8')).gateway.heartbeat.targetChatId).toBe(address);
    expect(runBootstrapMigrationsSync(path).changed).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('blocks an ambiguous delivery configuration without modifying the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-conversation-config-'));
  try {
    const path = join(dir, 'xopc.json');
    const original = JSON.stringify({ gateway: { heartbeat: { target: 'telegram', targetChatId: 'agent:main:weixin:personal:direct:peer' } } });
    writeFileSync(path, original);
    expect(() => runBootstrapMigrationsSync(path)).toThrow('disagree');
    expect(readFileSync(path, 'utf8')).toBe(original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
