import { readFileSync } from 'node:fs';
import { hvigor } from '@ohos/hvigor';
import { appTasks, OhosAppContext, OhosPluginId } from '@ohos/hvigor-ohos-plugin';

// Keep local debug signing material out of tracked build profiles and command arguments.
hvigor.getRootNode().afterNodeEvaluate((node) => {
  const path = process.env.HARMONY_DEBUG_SIGNING_PROFILE;
  if (!path) return;
  const context = node.getContext(OhosPluginId.OHOS_APP_PLUGIN) as OhosAppContext;
  if (context.getBuildMode() !== 'debug') throw new Error('Local device signing is restricted to debug builds.');
  const local = JSON.parse(readFileSync(path, 'utf8')) as ReturnType<OhosAppContext['getBuildProfileOpt']>;
  const profile = context.getBuildProfileOpt();
  if (!local.app.signingConfigs?.length) throw new Error('Local debug signing configuration is missing.');
  profile.app.signingConfigs = local.app.signingConfigs;
  for (const product of profile.app.products) {
    const signing = local.app.products.find((item) => item.name === product.name)?.signingConfig;
    if (!signing) throw new Error('Local debug product signing configuration is missing.');
    product.signingConfig = signing;
  }
  context.setBuildProfileOpt(profile);
});

export default { system: appTasks, plugins: [] };
