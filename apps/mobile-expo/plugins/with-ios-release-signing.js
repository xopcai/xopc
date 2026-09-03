const { withXcodeProject } = require('expo/config-plugins');

function configureReleaseSigning(project, teamId, profiles) {
  const targets = project.pbxNativeTargetSection();
  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile) throw new Error(`Missing distribution provisioning profile for ${name}`);
    const target = Object.values(targets).find((entry) => entry?.name === name || entry?.name === `"${name}"`);
    if (!target) throw new Error(`Missing iOS signing target: ${name}`);
    const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
    for (const reference of list.buildConfigurations ?? []) {
      const config = project.pbxXCBuildConfigurationSection()[reference.value];
      if (config.name.replaceAll('"', '') !== 'Release') continue;
      Object.assign(config.buildSettings, {
        CODE_SIGN_STYLE: 'Manual',
        CODE_SIGN_IDENTITY: '"Apple Distribution"',
        DEVELOPMENT_TEAM: teamId,
        PROVISIONING_PROFILE_SPECIFIER: JSON.stringify(profile),
      });
    }
  }
}

function withIosReleaseSigning(config) {
  // Xcode mods run in reverse registration order; register before target creators.
  if (process.env.SIGNING_STYLE !== 'manual') return config;
  const teamId = process.env.DEVELOPMENT_TEAM || process.env.APPLE_TEAM_ID;
  if (!teamId) throw new Error('Manual iOS signing requires DEVELOPMENT_TEAM or APPLE_TEAM_ID');
  return withXcodeProject(config, (mod) => {
    configureReleaseSigning(mod.modResults, teamId, {
      [mod.modRequest.projectName]: process.env.IOS_PROVISIONING_PROFILE_MAIN,
      ShareIntake: process.env.IOS_PROVISIONING_PROFILE_SHARE,
      ExpoWidgetsTarget: process.env.IOS_PROVISIONING_PROFILE_WIDGET,
    });
    return mod;
  });
}

module.exports = withIosReleaseSigning;
module.exports.configureReleaseSigning = configureReleaseSigning;
