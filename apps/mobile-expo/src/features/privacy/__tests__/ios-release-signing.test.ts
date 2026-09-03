import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configureReleaseSigning } = require('../../../../plugins/with-ios-release-signing') as {
  configureReleaseSigning: (project: unknown, team: string, profiles: Record<string, string>) => void;
};

function fixture() {
  const configs: Record<string, { name: string; buildSettings: Record<string, string> }> = {};
  const targets: Record<string, { name: string; buildConfigurationList: string }> = {};
  const lists: Record<string, { buildConfigurations: Array<{ value: string }> }> = {};
  for (const name of ['xopc', 'ShareIntake', 'ExpoWidgetsTarget']) {
    targets[name] = { name, buildConfigurationList: name };
    configs[`${name}-release`] = { name: 'Release', buildSettings: { CODE_SIGN_ENTITLEMENTS: `${name}/${name}.entitlements` } };
    configs[`${name}-debug`] = { name: 'Debug', buildSettings: { CODE_SIGN_STYLE: 'Automatic' } };
    lists[name] = { buildConfigurations: [{ value: `${name}-release` }, { value: `${name}-debug` }] };
  }
  return {
    configs,
    project: { pbxNativeTargetSection: () => targets, pbxXCConfigurationList: () => lists, pbxXCBuildConfigurationSection: () => configs },
  };
}

describe('iOS archive signing', () => {
  it('assigns separate distribution profiles while preserving each target entitlement path', () => {
    const { project, configs } = fixture();
    const profiles = { xopc: 'main-profile', ShareIntake: 'share-profile', ExpoWidgetsTarget: 'widget-profile' };
    configureReleaseSigning(project, 'TESTTEAM', profiles);
    for (const [name, profile] of Object.entries(profiles)) {
      expect(configs[`${name}-release`].buildSettings).toMatchObject({
        CODE_SIGN_STYLE: 'Manual', CODE_SIGN_IDENTITY: '"Apple Distribution"', DEVELOPMENT_TEAM: 'TESTTEAM',
        PROVISIONING_PROFILE_SPECIFIER: JSON.stringify(profile), CODE_SIGN_ENTITLEMENTS: `${name}/${name}.entitlements`,
      });
      expect(configs[`${name}-debug`].buildSettings).toEqual({ CODE_SIGN_STYLE: 'Automatic' });
    }
  });

  it('rejects missing target profiles rather than silently archiving without entitlements', () => {
    const { project } = fixture();
    expect(() => configureReleaseSigning(project, 'TESTTEAM', { xopc: '' })).toThrow('Missing distribution provisioning profile');
    expect(() => configureReleaseSigning(project, 'TESTTEAM', { MissingTarget: 'profile' })).toThrow('Missing iOS signing target');
  });
});
