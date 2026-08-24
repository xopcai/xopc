const { withXcodeProject } = require('expo/config-plugins');

const TARGET_NAME = 'ExpoWidgetsTarget';

function targetByName(project, name) {
  return Object.entries(project.pbxNativeTargetSection())
    .find(([, target]) => target?.name === name || target?.name === `"${name}"`);
}

function setTargetVersion(project, targetName, version, buildNumber) {
  const targetEntry = targetByName(project, targetName);
  if (!targetEntry) throw new Error(`${targetName} must be generated before version synchronization`);

  const [, target] = targetEntry;
  const configList = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const buildConfigurations = project.pbxXCBuildConfigurationSection();
  for (const config of configList.buildConfigurations ?? []) {
    const buildConfiguration = buildConfigurations[config.value];
    buildConfiguration.buildSettings.MARKETING_VERSION = version;
    buildConfiguration.buildSettings.CURRENT_PROJECT_VERSION = buildNumber;
  }
}

function withIosWidgetVersion(config) {
  const version = config.version ?? '1.0';
  const buildNumber = config.ios?.buildNumber ?? '1';
  return withXcodeProject(config, (config) => {
    setTargetVersion(config.modResults, config.modRequest.projectName, version, buildNumber);
    setTargetVersion(config.modResults, TARGET_NAME, version, buildNumber);
    return config;
  });
}

module.exports = withIosWidgetVersion;
module.exports.setTargetVersion = setTargetVersion;
