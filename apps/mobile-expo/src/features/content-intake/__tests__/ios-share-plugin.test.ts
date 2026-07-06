import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TARGET_NAME, buildShareExtensionInfoPlist, buildShareViewControllerSwift } = require('../../../../plugins/with-ios-share-intake') as {
  TARGET_NAME: string;
  buildShareExtensionInfoPlist: (bundleIdentifier: string) => string;
  buildShareViewControllerSwift: () => string;
};

describe('with-ios-share-intake', () => {
  it('generates a share extension plist for text and urls', () => {
    const plist = buildShareExtensionInfoPlist('ai.xopc.xopc.ShareIntake');

    expect(TARGET_NAME).toBe('ShareIntake');
    expect(plist).toContain('<string>ai.xopc.xopc.ShareIntake</string>');
    expect(plist).toContain('<string>com.apple.share-services</string>');
    expect(plist).toContain('<key>NSExtensionActivationSupportsText</key>');
    expect(plist).toContain('<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>');
    expect(plist).toContain('<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>');
  });

  it('routes shared text through the existing intake deep link', () => {
    const source = buildShareViewControllerSwift();

    expect(source).toContain('URLComponents(string: "xopc:///intake")');
    expect(source).toContain('URLQueryItem(name: "text", value: text)');
    expect(source).toContain('UTType.plainText.identifier');
    expect(source).toContain('UTType.url.identifier');
    expect(source).toContain('Selector(("openURL:"))');
    expect(source).not.toContain('UIApplication.openURL');
  });
});
