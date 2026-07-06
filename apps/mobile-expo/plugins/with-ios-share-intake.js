const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const TARGET_NAME = 'ShareIntake';
const SWIFT_FILE = 'ShareViewController.swift';
const PLIST_FILE = `${TARGET_NAME}-Info.plist`;

function buildShareExtensionInfoPlist(bundleIdentifier) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>$(DEVELOPMENT_LANGUAGE)</string>
\t<key>CFBundleDisplayName</key>
\t<string>xopc</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>${bundleIdentifier}</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundlePackageType</key>
\t<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
\t<key>CFBundleShortVersionString</key>
\t<string>$(MARKETING_VERSION)</string>
\t<key>CFBundleVersion</key>
\t<string>$(CURRENT_PROJECT_VERSION)</string>
\t<key>NSExtension</key>
\t<dict>
\t\t<key>NSExtensionAttributes</key>
\t\t<dict>
\t\t\t<key>NSExtensionActivationRule</key>
\t\t\t<dict>
\t\t\t\t<key>NSExtensionActivationSupportsText</key>
\t\t\t\t<true/>
\t\t\t\t<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
\t\t\t\t<integer>1</integer>
\t\t\t</dict>
\t\t</dict>
\t\t<key>NSExtensionPointIdentifier</key>
\t\t<string>com.apple.share-services</string>
\t\t<key>NSExtensionPrincipalClass</key>
\t\t<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
\t</dict>
</dict>
</plist>
`;
}

function buildShareViewControllerSwift() {
  return `import Social
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    routeSharedContent()
  }

  private func routeSharedContent() {
    guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
          let providers = item.attachments,
          let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) || $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) else {
      finish()
      return
    }

    if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] item, _ in
        self?.openIntake(text: self?.stringValue(from: item) ?? "")
      }
      return
    }

    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
      self?.openIntake(text: self?.stringValue(from: item) ?? "")
    }
  }

  private func stringValue(from item: NSSecureCoding?) -> String {
    if let url = item as? URL {
      return url.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return (item as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  private func openIntake(text: String) {
    guard !text.isEmpty,
          var components = URLComponents(string: "xopc:///intake") else {
      finish()
      return
    }
    components.queryItems = [URLQueryItem(name: "text", value: text)]
    guard let url = components.url else {
      finish()
      return
    }

    DispatchQueue.main.async {
      _ = self.openURL(url)
      self.finish()
    }
  }

  private func openURL(_ url: URL) -> Bool {
    let selector = Selector(("openURL:"))
    var responder: UIResponder? = self
    while responder != nil {
      if responder?.responds(to: selector) == true {
        return responder?.perform(selector, with: url) != nil
      }
      responder = responder?.next
    }
    return false
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil)
  }
}
`;
}

function ensureShareExtensionFiles(iosRoot, bundleIdentifier) {
  const extensionRoot = path.join(iosRoot, TARGET_NAME);
  fs.mkdirSync(extensionRoot, { recursive: true });
  fs.writeFileSync(path.join(extensionRoot, PLIST_FILE), buildShareExtensionInfoPlist(bundleIdentifier));
  fs.writeFileSync(path.join(extensionRoot, SWIFT_FILE), buildShareViewControllerSwift());
}

function getTargetByName(project, name) {
  const targetSection = project.pbxNativeTargetSection();
  return Object.entries(targetSection).find(([, target]) => target?.name === `"${name}"` || target?.name === name) ?? null;
}

function getMainGroup(project) {
  return project.getFirstProject().firstProject.mainGroup;
}

function ensureGroup(project) {
  const existing = project.pbxGroupByName(TARGET_NAME);
  if (existing) {
    const groups = project.hash.project.objects.PBXGroup;
    const entry = Object.entries(groups).find(([, group]) => group === existing);
    if (entry) return entry[0];
  }

  const group = project.pbxCreateGroup(TARGET_NAME, TARGET_NAME);
  project.addToPbxGroup(group, getMainGroup(project));
  return group;
}

function ensureBuildPhase(project, targetUuid, phaseType, name) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const hasPhase = target.buildPhases?.some((phase) => phase.comment === name);
  if (!hasPhase) project.addBuildPhase([], phaseType, name, targetUuid);
}

function ensureFile(project, group, fileName, targetUuid, kind) {
  const filePath = `${TARGET_NAME}/${fileName}`;
  if (project.hasFile(filePath) || project.hasFile(fileName)) return;
  if (kind === 'source') {
    project.addSourceFile(fileName, { target: targetUuid }, group);
    return;
  }
  project.addFile(fileName, group, { target: targetUuid });
}

function setTargetBuildProperty(project, targetUuid, property, value) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const configList = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configs = project.pbxXCBuildConfigurationSection();
  for (const config of configList.buildConfigurations ?? []) {
    const buildConfig = configs[config.value];
    buildConfig.buildSettings[property] = value;
  }
}

function ensureShareExtensionTarget(project, appBundleIdentifier, version = '1.0', buildNumber = '1') {
  const extensionBundleIdentifier = `${appBundleIdentifier}.${TARGET_NAME}`;
  const existing = getTargetByName(project, TARGET_NAME);
  const target = existing
    ? { uuid: existing[0], pbxNativeTarget: existing[1] }
    : project.addTarget(TARGET_NAME, 'app_extension', TARGET_NAME, extensionBundleIdentifier);

  const targetUuid = target.uuid;
  ensureBuildPhase(project, targetUuid, 'PBXSourcesBuildPhase', 'Sources');
  ensureBuildPhase(project, targetUuid, 'PBXResourcesBuildPhase', 'Resources');
  ensureBuildPhase(project, targetUuid, 'PBXFrameworksBuildPhase', 'Frameworks');

  const group = ensureGroup(project);
  ensureFile(project, group, SWIFT_FILE, targetUuid, 'source');
  ensureFile(project, group, PLIST_FILE, targetUuid, 'plist');

  setTargetBuildProperty(project, targetUuid, 'INFOPLIST_FILE', `"${TARGET_NAME}/${PLIST_FILE}"`);
  setTargetBuildProperty(project, targetUuid, 'PRODUCT_BUNDLE_IDENTIFIER', `"${extensionBundleIdentifier}"`);
  setTargetBuildProperty(project, targetUuid, 'SWIFT_VERSION', '5.0');
  setTargetBuildProperty(project, targetUuid, 'APPLICATION_EXTENSION_API_ONLY', 'YES');
  setTargetBuildProperty(project, targetUuid, 'MARKETING_VERSION', version);
  setTargetBuildProperty(project, targetUuid, 'CURRENT_PROJECT_VERSION', buildNumber);
  return targetUuid;
}

function withIosShareIntake(config) {
  const appBundleIdentifier = config.ios?.bundleIdentifier;
  const version = config.version ?? '1.0';
  const buildNumber = config.ios?.buildNumber ?? '1';
  if (!appBundleIdentifier) {
    throw new Error('with-ios-share-intake requires expo.ios.bundleIdentifier');
  }

  config = withDangerousMod(config, ['ios', (config) => {
    ensureShareExtensionFiles(config.modRequest.platformProjectRoot, `${appBundleIdentifier}.${TARGET_NAME}`);
    return config;
  }]);

  return withXcodeProject(config, (config) => {
    ensureShareExtensionTarget(config.modResults, appBundleIdentifier, version, buildNumber);
    return config;
  });
}

module.exports = withIosShareIntake;
module.exports.TARGET_NAME = TARGET_NAME;
module.exports.buildShareExtensionInfoPlist = buildShareExtensionInfoPlist;
module.exports.buildShareViewControllerSwift = buildShareViewControllerSwift;
module.exports.ensureShareExtensionTarget = ensureShareExtensionTarget;
