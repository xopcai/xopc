const { withProjectBuildGradle } = require('expo/config-plugins');

const MIRROR_REPOS = `    maven { url 'https://maven.aliyun.com/repository/google' }
    maven { url 'https://maven.aliyun.com/repository/central' }
    maven { url 'https://maven.aliyun.com/repository/public' }
`;

function injectMirrors(contents) {
  if (contents.includes('maven.aliyun.com')) {
    return contents;
  }
  return contents
    .replace(
      /buildscript\s*\{\s*repositories\s*\{/,
      `buildscript {\n  repositories {\n${MIRROR_REPOS}`,
    )
    .replace(
      /allprojects\s*\{\s*repositories\s*\{/,
      `allprojects {\n  repositories {\n${MIRROR_REPOS}`,
    );
}

/** Prefer Aliyun mirrors before google()/mavenCentral() for reliable dependency downloads. */
function withAndroidMavenMirrors(config) {
  return withProjectBuildGradle(config, (config) => {
    config.modResults.contents = injectMirrors(config.modResults.contents);
    return config;
  });
}

module.exports = withAndroidMavenMirrors;
