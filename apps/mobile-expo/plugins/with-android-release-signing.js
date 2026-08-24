const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// xopc: Android release signing';

const RELEASE_PROPERTIES = `${MARKER}
def xopcUploadStoreFile = findProperty('XOPC_UPLOAD_STORE_FILE')
def xopcUploadStorePassword = findProperty('XOPC_UPLOAD_STORE_PASSWORD')
def xopcUploadKeyAlias = findProperty('XOPC_UPLOAD_KEY_ALIAS')
def xopcUploadKeyPassword = findProperty('XOPC_UPLOAD_KEY_PASSWORD')
def xopcReleaseBuildRequested = gradle.startParameter.taskNames.any {
    it.toLowerCase().contains('release')
}
def xopcMissingSigningProperties = [
    XOPC_UPLOAD_STORE_FILE: xopcUploadStoreFile,
    XOPC_UPLOAD_STORE_PASSWORD: xopcUploadStorePassword,
    XOPC_UPLOAD_KEY_ALIAS: xopcUploadKeyAlias,
    XOPC_UPLOAD_KEY_PASSWORD: xopcUploadKeyPassword,
].findAll { _, value -> !value }.keySet()

if (xopcReleaseBuildRequested && !xopcMissingSigningProperties.isEmpty()) {
    throw new GradleException(
        "Missing Android release signing properties: \${xopcMissingSigningProperties.join(', ')}"
    )
}

`;

const RELEASE_SIGNING_CONFIG = `        release {
            if (xopcUploadStoreFile) {
                storeFile file(xopcUploadStoreFile)
                storePassword xopcUploadStorePassword
                keyAlias xopcUploadKeyAlias
                keyPassword xopcUploadKeyPassword
            }
        }
`;

function injectReleaseSigning(contents) {
  if (contents.includes(MARKER)) {
    return contents;
  }

  let next = contents.replace(/^android\s*\{/m, `${RELEASE_PROPERTIES}android {`);
  if (next === contents) {
    throw new Error('Unable to find the Android Gradle block for release signing');
  }

  const signingConfigsPattern = /(signingConfigs\s*\{\s*\n)(\s*debug\s*\{)/;
  if (!signingConfigsPattern.test(next)) {
    throw new Error('Unable to find Android signingConfigs.debug');
  }
  next = next.replace(signingConfigsPattern, `$1${RELEASE_SIGNING_CONFIG}$2`);

  const releaseBuildTypePattern = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
  if (!releaseBuildTypePattern.test(next)) {
    throw new Error('Unable to find the Android release build type signing config');
  }
  return next.replace(
    releaseBuildTypePattern,
    '$1signingConfig signingConfigs.release',
  );
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('Android release signing requires a Groovy app/build.gradle');
    }
    config.modResults.contents = injectReleaseSigning(config.modResults.contents);
    return config;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.injectReleaseSigning = injectReleaseSigning;
