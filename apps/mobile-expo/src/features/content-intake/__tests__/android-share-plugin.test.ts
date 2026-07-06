import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ensureTextShareFilter, hasTextShareFilter, injectShareIntake } = require('../../../../plugins/with-android-share-intake') as {
  ensureTextShareFilter: (activity: Record<string, unknown>) => Record<string, unknown>;
  hasTextShareFilter: (activity: Record<string, unknown>) => boolean;
  injectShareIntake: (contents: string) => string;
};

const mainActivity = `package ai.xopc.xopc

import android.os.Bundle

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }
}
`;

describe('with-android-share-intake', () => {
  it('detects existing text share intent filters', () => {
    expect(hasTextShareFilter({
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        data: [{ $: { 'android:mimeType': 'text/plain' } }],
      }],
    })).toBe(true);
  });

  it('adds the text share intent filter only once', () => {
    const activity: Record<string, unknown> = {
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      }],
    };

    ensureTextShareFilter(activity);
    ensureTextShareFilter(activity);

    const filters = activity['intent-filter'] as Array<{
      action?: Array<{ $?: Record<string, string> }>;
      data?: Array<{ $?: Record<string, string> }>;
    }>;
    const shareFilters = filters.filter((filter) =>
      filter.action?.some((action) => action.$?.['android:name'] === 'android.intent.action.SEND') &&
      filter.data?.some((data) => data.$?.['android:mimeType'] === 'text/plain')
    );

    expect(filters).toHaveLength(2);
    expect(shareFilters).toHaveLength(1);
  });

  it('injects share handling without duplicating onCreate', () => {
    const result = injectShareIntake(mainActivity);

    expect(result.match(/override fun onCreate/g)).toHaveLength(1);
    expect(result.match(/override fun onNewIntent/g)).toHaveLength(1);
    expect(result).toContain('setIntent(sharedTextIntakeIntent(intent) ?: intent)');
    expect(result).toContain('override fun onNewIntent(intent: Intent)');
    expect(result).toContain('super.onNewIntent(routedIntent)');
    expect(result).toContain('.path("/intake")');
    expect(result).toContain('Intent.EXTRA_TITLE');
    expect(result).toContain('appendQueryParameter("title", sharedTitle)');
  });

  it('is idempotent', () => {
    const once = injectShareIntake(mainActivity);
    const twice = injectShareIntake(once);

    expect(twice).toBe(once);
  });
});
