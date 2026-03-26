import { describe, it, expect } from 'vitest';
import { join } from 'path';

import { resolveSessionShardRelativePath } from '../shard-path.js';

describe('resolveSessionShardRelativePath', () => {
  it('places cron sessions under system/cron', () => {
    expect(resolveSessionShardRelativePath('cron:job-1')).toBe(join('system', 'cron'));
  });

  it('places heartbeat sessions under system/heartbeat', () => {
    expect(resolveSessionShardRelativePath('heartbeat:main')).toBe(join('system', 'heartbeat'));
    expect(resolveSessionShardRelativePath('heartbeat:isolated:123')).toBe(join('system', 'heartbeat'));
  });

  it('places routing keys under users/.../peer', () => {
    expect(resolveSessionShardRelativePath('main:telegram:default:dm:123456')).toBe(
      join('users', 'main', 'telegram', 'default', 'dm', '123456')
    );
  });

  it('adds thread and scope segments when present', () => {
    expect(
      resolveSessionShardRelativePath('main:discord:work:channel:987654:thread:789:scope:scope1')
    ).toBe(join('users', 'main', 'discord', 'work', 'channel', '987654', 'thread', '789', 'scope', 'scope1'));
  });

  it('uses system/misc for invalid keys', () => {
    expect(resolveSessionShardRelativePath('invalid-key')).toBe(join('system', 'misc'));
    expect(resolveSessionShardRelativePath('')).toBe(join('system', 'misc'));
  });
});
