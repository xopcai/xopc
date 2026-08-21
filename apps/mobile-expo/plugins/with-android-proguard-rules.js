const { withDangerousMod } = require('expo/config-plugins');

const RULES = `
# Expo UI references these compatibility types conditionally. They are absent in
# the current SDK dependency graph, so R8 must not treat them as required.
-dontwarn expo.modules.kotlin.types.ColorCompat
-dontwarn expo.modules.kotlin.types.ColorCompat$Companion
`;

function withAndroidProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const fs = require('fs/promises');
      const path = require('path');
      const rulesPath = path.join(config.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const contents = await fs.readFile(rulesPath, 'utf8');

      if (!contents.includes('-dontwarn expo.modules.kotlin.types.ColorCompat')) {
        await fs.writeFile(rulesPath, `${contents.trimEnd()}\n${RULES}`, 'utf8');
      }

      return config;
    },
  ]);
}

module.exports = withAndroidProguardRules;
