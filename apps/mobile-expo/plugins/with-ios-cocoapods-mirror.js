const { withPodfile } = require('expo/config-plugins');

const TSINGHUA_SOURCE =
  "source 'https://mirrors.tuna.tsinghua.edu.cn/git/CocoaPods/Specs.git'";

/** Prefer Tsinghua Specs mirror over cdn.cocoapods.org for reliable pod installs. */
function injectPodMirror(contents) {
  if (contents.includes('mirrors.tuna.tsinghua.edu.cn')) {
    return contents;
  }
  if (/source\s+['"]https:\/\/cdn\.cocoapods\.org\/?['"]/.test(contents)) {
    return contents.replace(
      /source\s+['"]https:\/\/cdn\.cocoapods\.org\/?['"]\s*\n?/,
      `${TSINGHUA_SOURCE}\n`,
    );
  }
  return `${TSINGHUA_SOURCE}\n${contents}`;
}

function withIosCocoaPodsMirror(config) {
  return withPodfile(config, (config) => {
    config.modResults.contents = injectPodMirror(config.modResults.contents);
    return config;
  });
}

module.exports = withIosCocoaPodsMirror;
