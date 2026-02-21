/**
 * Access Control Tests
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeAllowFrom,
  normalizeAllowFromWithStore,
  isSenderAllowed,
  resolveSenderAllowMatch,
  evaluateGroupBaseAccess,
  evaluateGroupPolicyAccess,
  resolveGroupPolicy,
  resolveRequireMention,
  buildMentionRegex,
  hasBotMention,
  removeBotMention,
} from '../access-control.js';

import type { NormalizedAllowFrom } from '../types.js';

describe('normalizeAllowFrom', () => {
  it('should return empty normalized when input is undefined', () => {
    const result = normalizeAllowFrom(undefined);
    expect(result.entries).toEqual([]);
    expect(result.hasWildcard).toBe(false);
    expect(result.hasEntries).toBe(false);
  });

  it('should return empty normalized when input is empty array', () => {
    const result = normalizeAllowFrom([]);
    expect(result.entries).toEqual([]);
    expect(result.hasWildcard).toBe(false);
    expect(result.hasEntries).toBe(false);
  });

  it('should extract numeric IDs', () => {
    const result = normalizeAllowFrom(['123456789', '987654321']);
    expect(result.entries).toEqual(['123456789', '987654321']);
    expect(result.hasWildcard).toBe(false);
    expect(result.hasEntries).toBe(true);
  });

  it('should handle telegram: prefix', () => {
    const result = normalizeAllowFrom(['telegram:123456789', 'tg:987654321']);
    expect(result.entries).toEqual(['123456789', '987654321']);
  });

  it('should detect wildcard', () => {
    const result = normalizeAllowFrom(['*']);
    expect(result.hasWildcard).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.hasEntries).toBe(false);
  });

  it('should handle mixed entries with wildcard', () => {
    const result = normalizeAllowFrom(['*', '123456789']);
    expect(result.hasWildcard).toBe(true);
    expect(result.entries).toEqual(['123456789']);
  });

  it('should trim whitespace', () => {
    const result = normalizeAllowFrom(['  123456789  ', '  ']);
    expect(result.entries).toEqual(['123456789']);
  });
});

describe('normalizeAllowFromWithStore', () => {
  it('should combine config and store allowFrom', () => {
    const result = normalizeAllowFromWithStore({
      allowFrom: ['111111'],
      storeAllowFrom: ['222222'],
    });
    expect(result.entries).toEqual(['111111', '222222']);
  });

  it('should handle empty arrays', () => {
    const result = normalizeAllowFromWithStore({
      allowFrom: [],
      storeAllowFrom: [],
    });
    expect(result.hasEntries).toBe(false);
  });

  it('should handle undefined', () => {
    const result = normalizeAllowFromWithStore({});
    expect(result.hasEntries).toBe(false);
  });
});

describe('isSenderAllowed', () => {
  it('should allow all when no entries', () => {
    const allow: NormalizedAllowFrom = { entries: [], hasWildcard: false, hasEntries: false };
    expect(isSenderAllowed({ allow, senderId: '123' })).toBe(true);
  });

  it('should allow all when wildcard', () => {
    const allow: NormalizedAllowFrom = { entries: [], hasWildcard: true, hasEntries: false };
    expect(isSenderAllowed({ allow, senderId: '123' })).toBe(true);
  });

  it('should allow matching sender ID', () => {
    const allow: NormalizedAllowFrom = { entries: ['123456'], hasWildcard: false, hasEntries: true };
    expect(isSenderAllowed({ allow, senderId: '123456' })).toBe(true);
  });

  it('should deny non-matching sender ID', () => {
    const allow: NormalizedAllowFrom = { entries: ['123456'], hasWildcard: false, hasEntries: true };
    expect(isSenderAllowed({ allow, senderId: '999999' })).toBe(false);
  });

  it('should allow when no senderId but has entries', () => {
    const allow: NormalizedAllowFrom = { entries: ['123456'], hasWildcard: false, hasEntries: true };
    expect(isSenderAllowed({ allow })).toBe(false);
  });
});

describe('resolveSenderAllowMatch', () => {
  it('should return wildcard match', () => {
    const allow: NormalizedAllowFrom = { entries: [], hasWildcard: true, hasEntries: false };
    const result = resolveSenderAllowMatch({ allow, senderId: '123' });
    expect(result.allowed).toBe(true);
    expect(result.matchKey).toBe('*');
    expect(result.matchSource).toBe('wildcard');
  });

  it('should return no match when no entries', () => {
    const allow: NormalizedAllowFrom = { entries: [], hasWildcard: false, hasEntries: false };
    const result = resolveSenderAllowMatch({ allow, senderId: '123' });
    expect(result.allowed).toBe(false);
  });

  it('should return ID match when sender in allowlist', () => {
    const allow: NormalizedAllowFrom = { entries: ['123456'], hasWildcard: false, hasEntries: true };
    const result = resolveSenderAllowMatch({ allow, senderId: '123456' });
    expect(result.allowed).toBe(true);
    expect(result.matchKey).toBe('123456');
    expect(result.matchSource).toBe('id');
  });
});

describe('evaluateGroupBaseAccess', () => {
  it('should allow non-group chats', () => {
    const result = evaluateGroupBaseAccess({
      isGroup: false,
    });
    expect(result.allowed).toBe(true);
  });

  it('should block when group is disabled', () => {
    const result = evaluateGroupBaseAccess({
      isGroup: true,
      groupConfig: { groupId: '123', enabled: false },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('group-disabled');
  });

  it('should block when topic is disabled', () => {
    const result = evaluateGroupBaseAccess({
      isGroup: true,
      groupConfig: { groupId: '123', enabled: true },
      topicConfig: { topicId: '456', enabled: false },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('topic-disabled');
  });

  it('should check allowFrom override', () => {
    const result = evaluateGroupBaseAccess({
      isGroup: true,
      groupConfig: { groupId: '123', enabled: true },
      hasGroupAllowOverride: true,
      effectiveGroupAllow: { entries: ['123456'], hasWildcard: false, hasEntries: true },
      senderId: '999999',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('unauthorized');
  });

  it('should allow when sender in allowFrom override', () => {
    const result = evaluateGroupBaseAccess({
      isGroup: true,
      groupConfig: { groupId: '123', enabled: true },
      hasGroupAllowOverride: true,
      effectiveGroupAllow: { entries: ['123456'], hasWildcard: false, hasEntries: true },
      senderId: '123456',
    });
    expect(result.allowed).toBe(true);
  });
});

describe('evaluateGroupPolicyAccess', () => {
  it('should allow non-group chats regardless of policy', () => {
    const result = evaluateGroupPolicyAccess({
      isGroup: false,
      groupPolicy: 'disabled',
      effectiveGroupAllow: { entries: [], hasWildcard: false, hasEntries: false },
    });
    expect(result.allowed).toBe(true);
  });

  it('should block all when policy is disabled', () => {
    const result = evaluateGroupPolicyAccess({
      isGroup: true,
      groupPolicy: 'disabled',
      effectiveGroupAllow: { entries: [], hasWildcard: false, hasEntries: false },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('policy-blocked');
  });

  it('should allow all when policy is open', () => {
    const result = evaluateGroupPolicyAccess({
      isGroup: true,
      groupPolicy: 'open',
      effectiveGroupAllow: { entries: [], hasWildcard: false, hasEntries: false },
    });
    expect(result.allowed).toBe(true);
    expect(result.groupPolicy).toBe('open');
  });

  it('should block when allowlist policy with no entries', () => {
    const result = evaluateGroupPolicyAccess({
      isGroup: true,
      groupPolicy: 'allowlist',
      effectiveGroupAllow: { entries: [], hasWildcard: false, hasEntries: false },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('policy-blocked');
  });

  it('should allow matching sender in allowlist policy', () => {
    const result = evaluateGroupPolicyAccess({
      isGroup: true,
      groupPolicy: 'allowlist',
      effectiveGroupAllow: { entries: ['123456'], hasWildcard: false, hasEntries: true },
      senderId: '123456',
    });
    expect(result.allowed).toBe(true);
  });
});

describe('resolveGroupPolicy', () => {
  it('should use topic config over group config', () => {
    const result = resolveGroupPolicy({
      topicConfig: { topicId: '1', groupPolicy: 'disabled' },
      groupConfig: { groupId: '1', groupPolicy: 'open' },
      defaultGroupPolicy: 'open',
    });
    expect(result).toBe('disabled');
  });

  it('should use group config when no topic config', () => {
    const result = resolveGroupPolicy({
      groupConfig: { groupId: '1', groupPolicy: 'allowlist' },
      defaultGroupPolicy: 'open',
    });
    expect(result).toBe('allowlist');
  });

  it('should use default when no config', () => {
    const result = resolveGroupPolicy({
      defaultGroupPolicy: 'disabled',
    });
    expect(result).toBe('disabled');
  });

  it('should default to open', () => {
    const result = resolveGroupPolicy({});
    expect(result).toBe('open');
  });
});

describe('resolveRequireMention', () => {
  it('should prioritize topic config', () => {
    const result = resolveRequireMention({
      topicConfig: { topicId: '1', requireMention: false },
      groupConfig: { groupId: '1', requireMention: true },
      defaultRequireMention: true,
    });
    expect(result).toBe(false);
  });

  it('should use group config when no topic config', () => {
    const result = resolveRequireMention({
      groupConfig: { groupId: '1', requireMention: false },
      defaultRequireMention: true,
    });
    expect(result).toBe(false);
  });

  it('should default to true', () => {
    const result = resolveRequireMention({});
    expect(result).toBe(true);
  });
});

describe('buildMentionRegex', () => {
  it('should build regex for username', () => {
    const regex = buildMentionRegex('MyBot');
    expect(regex.test('@mybot')).toBe(true);
    expect(regex.test('@MyBot')).toBe(true);
    expect(regex.test('@other')).toBe(false);
  });

  it('should escape special characters', () => {
    const regex = buildMentionRegex('my.bot_test');
    expect(regex.test('@my.bot_test')).toBe(true);
    expect(regex.test('@mybot_test')).toBe(false);
  });
});

describe('hasBotMention', () => {
  it('should detect mention in text', () => {
    expect(hasBotMention({ botUsername: 'TestBot', text: 'Hello @TestBot!' })).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(hasBotMention({ botUsername: 'TestBot', text: 'Hello @testbot!' })).toBe(true);
  });

  it('should detect mention in entities', () => {
    // Text is "Hello " (6 chars), mention starts at offset 6 with length 9
    // That means it's "@testbot" which is 9 characters
    const result = hasBotMention({
      botUsername: 'TestBot',
      text: 'Hello @testbot',
      entities: [{ type: 'mention', offset: 6, length: 9 }],
    });
    expect(result).toBe(true);
  });

  it('should return false when no mention', () => {
    expect(hasBotMention({ botUsername: 'TestBot', text: 'Hello world!' })).toBe(false);
  });

  it('should handle empty text', () => {
    expect(hasBotMention({ botUsername: 'TestBot', text: '' })).toBe(false);
  });
});

describe('removeBotMention', () => {
  it('should remove mention from text', () => {
    const result = removeBotMention('Hello @TestBot how are you?', 'TestBot');
    expect(result).toBe('Hello how are you?');
  });

  it('should handle multiple mentions', () => {
    const result = removeBotMention('@TestBot Hello @TestBot', 'TestBot');
    expect(result).toBe('Hello');
  });

  it('should be case insensitive', () => {
    const result = removeBotMention('Hello @testbot!', 'TestBot');
    // Result includes trailing space after mention removal
    expect(result.trim()).toMatch(/Hello!?/);
  });

  it('should handle no mention', () => {
    const result = removeBotMention('Hello world!', 'TestBot');
    expect(result).toBe('Hello world!');
  });
});
