const { AndroidConfig, withAndroidManifest, withMainActivity } = require('expo/config-plugins');

const SHARE_IMPORTS_MARKER = '// xopc-share-intake-imports';
const SHARE_METHODS_MARKER = '// xopc-share-intake-methods';
const SHARE_ON_CREATE_CALL = 'setIntent(sharedTextIntakeIntent(intent) ?: intent)';
const ON_CREATE_SIGNATURE = /override fun onCreate\(savedInstanceState: (?:android\.os\.)?Bundle\?\)\s*\{/;

function textShareIntentFilter() {
  return {
    action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:mimeType': 'text/plain' } }],
  };
}

function hasTextShareFilter(activity) {
  return (activity['intent-filter'] ?? []).some((filter) =>
    filter.action?.some((action) => action.$?.['android:name'] === 'android.intent.action.SEND') &&
    filter.data?.some((data) => data.$?.['android:mimeType'] === 'text/plain')
  );
}

function ensureTextShareFilter(activity) {
  if (hasTextShareFilter(activity)) return activity;
  activity['intent-filter'] = [...(activity['intent-filter'] ?? []), textShareIntentFilter()];
  return activity;
}

function withAndroidTextShareManifest(config) {
  return withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    ensureTextShareFilter(mainActivity);
    return config;
  });
}

function insertAfterPackage(contents, insert) {
  if (contents.includes(SHARE_IMPORTS_MARKER)) return contents;
  const packageMatch = contents.match(/^package\s+.+$/m);
  if (!packageMatch) return `${insert}\n${contents}`;
  const index = packageMatch.index + packageMatch[0].length;
  return `${contents.slice(0, index)}\n\n${insert}${contents.slice(index)}`;
}

function insertBeforeLastBrace(contents, insert) {
  if (contents.includes(SHARE_METHODS_MARKER)) return contents;
  const index = contents.lastIndexOf('}');
  if (index < 0) return contents;
  return `${contents.slice(0, index).trimEnd()}\n\n${insert}\n${contents.slice(index)}`;
}

function injectOnCreateCall(contents) {
  if (contents.includes(SHARE_ON_CREATE_CALL)) return contents;
  const match = contents.match(ON_CREATE_SIGNATURE);
  if (!match || match.index == null) return contents;
  const start = match.index + match[0].length;
  return `${contents.slice(0, start)}\n    ${SHARE_ON_CREATE_CALL}${contents.slice(start)}`;
}

function injectShareIntake(contents) {
  if (!contents.includes('class MainActivity')) return contents;

  const imports = `${SHARE_IMPORTS_MARKER}
import android.content.Intent
import android.net.Uri`;

  const needsOnCreate = !ON_CREATE_SIGNATURE.test(contents);
  const onCreateMethod = needsOnCreate
    ? `  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    ${SHARE_ON_CREATE_CALL}
  }

`
    : '';
  const methods = `  ${SHARE_METHODS_MARKER}
${onCreateMethod}  override fun onNewIntent(intent: Intent) {
    val routedIntent = sharedTextIntakeIntent(intent) ?: intent
    super.onNewIntent(routedIntent)
    setIntent(routedIntent)
  }

  private fun sharedTextIntakeIntent(intent: Intent?): Intent? {
    if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return null
    val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
    if (sharedText.isEmpty()) return null
    val sharedTitle = intent.getStringExtra(Intent.EXTRA_TITLE)?.trim().orEmpty()
    val deepLink = Uri.Builder()
      .scheme("xopc")
      .path("/intake")
      .appendQueryParameter("text", sharedText)
      .apply {
        if (sharedTitle.isNotEmpty()) appendQueryParameter("title", sharedTitle)
      }
      .build()
    return Intent(Intent.ACTION_VIEW, deepLink)
  }`;

  const withImports = insertAfterPackage(contents, imports);
  return insertBeforeLastBrace(injectOnCreateCall(withImports), methods);
}

function withAndroidShareIntake(config) {
  config = withAndroidTextShareManifest(config);
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt' && config.modResults.language !== 'kotlin') {
      throw new Error('with-android-share-intake expects MainActivity.kt');
    }
    config.modResults.contents = injectShareIntake(config.modResults.contents);
    return config;
  });
}

module.exports = withAndroidShareIntake;
module.exports.injectShareIntake = injectShareIntake;
module.exports.hasTextShareFilter = hasTextShareFilter;
module.exports.ensureTextShareFilter = ensureTextShareFilter;
