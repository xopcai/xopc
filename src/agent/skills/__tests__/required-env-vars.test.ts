import { describe, expect, it } from 'vitest';

import {
  isValidSkillEnvVarName,
  parseRequiredEnvVarNames,
} from '../required-env-vars.js';

describe('isValidSkillEnvVarName', () => {
  it('accepts POSIX-style names', () => {
    expect(isValidSkillEnvVarName('FOO')).toBe(true);
    expect(isValidSkillEnvVarName('_BAR')).toBe(true);
    expect(isValidSkillEnvVarName('  BAZ  ')).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(isValidSkillEnvVarName('')).toBe(false);
    expect(isValidSkillEnvVarName('1A')).toBe(false);
    expect(isValidSkillEnvVarName('no-dash')).toBe(false);
  });
});

describe('parseRequiredEnvVarNames', () => {
  it('parses Hermes required_environment_variables', () => {
    const names = parseRequiredEnvVarNames({
      required_environment_variables: [{ name: 'API_TOKEN' }, { name: 'OTHER' }],
    });
    expect(names.sort()).toEqual(['API_TOKEN', 'OTHER']);
  });

  it('parses prerequisites.env_vars', () => {
    expect(
      parseRequiredEnvVarNames({
        prerequisites: { env_vars: ['A', 'B', 'A'] },
      }).sort(),
    ).toEqual(['A', 'B']);
  });

  it('parses requires.env', () => {
    expect(parseRequiredEnvVarNames({ requires: { env: 'SINGLE' } })).toEqual(['SINGLE']);
  });

  it('parses metadata.xopcbot.requires.env', () => {
    expect(
      parseRequiredEnvVarNames({
        metadata: { xopcbot: { requires: { env: ['X', 'Y'] } } },
      }).sort(),
    ).toEqual(['X', 'Y']);
  });

  it('merges and dedupes across sources', () => {
    const names = parseRequiredEnvVarNames({
      required_environment_variables: [{ name: 'SHARED' }],
      prerequisites: { env_vars: ['SHARED', 'ONLY_PRE'] },
      requires: { env: 'ONLY_REQ' },
    });
    expect(names.sort()).toEqual(['ONLY_PRE', 'ONLY_REQ', 'SHARED']);
  });

  it('ignores invalid entries in Hermes array', () => {
    expect(
      parseRequiredEnvVarNames({
        required_environment_variables: [{ name: 'OK' }, {}, { name: 'bad-name' }],
      }),
    ).toEqual(['OK']);
  });
});
