import { bundleManager } from '@kit.AbilityKit';

export function xopcAppVersion(): string {
  return bundleManager.getBundleInfoForSelfSync(
    bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT
  ).versionName;
}
