# 移动端构建与发布手册

本文记录 `apps/mobile-expo` 当前已经验证过的 Android 和 iOS 构建、签名与分发流程。两端均直接使用 GitHub Actions Runner 构建，不依赖付费的 EAS Build；EAS 只在首次创建或下载签名凭据时使用。

## 快速选择

| 目标 | 推荐入口 | 结果 |
| --- | --- | --- |
| 同时发布 Android 和 iOS 新版本 | `pnpm run mobile:release:patch` | Android APK/AAB、GitHub Release、TestFlight IPA |
| 只构建 Android | GitHub Actions → `Mobile Android Release` | Preview APK 或 Production APK/AAB |
| 只发布 iOS | GitHub Actions → `Mobile iOS TestFlight` | Production IPA，可选择是否上传 TestFlight |
| 本机 Android 构建 | `pnpm -C apps/mobile-expo run build:android:local` | `dist/android/` 下的 APK/AAB |
| 本机 iOS 构建并上传 | `pnpm run mobile:release:ios:testflight` | `dist/xopc.ipa` 并上传 TestFlight |

日常发布优先使用 GitHub Actions。签名凭据已经保存为 GitHub Actions Secrets，正常构建时不需要重新运行 EAS，也不需要在本机安装 Android SDK 或 Xcode。

## 发布前检查

iOS 首次上架还需完成 [App Store 准备清单](./ios-app-store-readiness.md)：隐私政策、审核网关、商店素材及真机验证。TestFlight 上传成功不代表已满足正式上架条件。发布脚本会检查最终 IPA 的签名权限和隐私清单，并将报告保存为 `dist/ios/verification.json`。

1. 确认要发布的代码已经提交，当前分支与远端同步。
2. 确认工作区干净：

   ```bash
   git status --short
   ```

3. 如需在发布前手动验证，可执行：

   ```bash
   pnpm run mobile:lint
   pnpm run mobile:typecheck
   pnpm run mobile:test
   pnpm run mobile:test:stream
   ```

GitHub Actions 也会执行以上检查；任意检查失败时不会继续生成发布包。

## 推荐：同时发布 Android 和 iOS

在仓库根目录运行：

```bash
pnpm run mobile:release:patch
```

该脚本会检查 Git 状态、运行质量检查、递增补丁版本及 Android `versionCode`，然后创建版本提交与 `mobile-expo-v<version>` Tag，并原子推送分支和 Tag。

Tag 会同时触发：

- `Mobile Android Release`：构建 Preview APK、Production APK/AAB，并用 Production APK 创建 GitHub Release。
- `Mobile iOS TestFlight`：构建、校验 Production IPA，并上传 TestFlight。

流水线地址：

- [Mobile Android Release](https://github.com/xopcai/xopc/actions/workflows/mobile-expo-release.yml)
- [Mobile iOS TestFlight](https://github.com/xopcai/xopc/actions/workflows/mobile-expo-ios-testflight.yml)

注意：该命令会创建提交、Tag 并推送，且要求工作区干净。仅想临时验证构建时，应使用下面的手动 Actions，不要创建发布 Tag。

## Android

### GitHub Actions 手动构建

1. 打开 [Mobile Android Release](https://github.com/xopcai/xopc/actions/workflows/mobile-expo-release.yml)。
2. 点击 `Run workflow`，选择构建分支和 `profile`：

   - `preview`：只生成可直接安装的 Preview APK。
   - `production`：生成正式签名的 Production APK 和 AAB。
   - `both`：同时执行以上两种构建。

3. 等待质量检查和对应的 `Build signed Android` Job 全部变绿。
4. 在 Run 页面底部下载 Artifact：

   - `xopc-android-preview`：包含 `xopc-android.apk`。
   - `xopc-android-production`：包含 `xopc-android.apk` 和 `xopc-android.aab`。

Artifact 保留 30 天。APK 可直接安装或分发；AAB 用于提交 Google Play。当前流水线不会自动上传 Google Play，Production AAB 仍需在 Play Console 中手动提交。

Tag 触发的正式发布还会创建 GitHub Release，并把 Production APK 附加到 Release；AAB 只作为私有 Actions Artifact 保存。

### Android 本机构建

本机需要 Node.js 22、pnpm、JDK 17 和 Android SDK，并需要正式 keystore。`apps/mobile-expo/credentials.json` 存在时，脚本会自动读取其中的 Android keystore 配置：

```bash
# 同时生成 APK 和 AAB
pnpm -C apps/mobile-expo run build:android:local

# 只生成其中一种
pnpm -C apps/mobile-expo run build:android:apk:local
pnpm -C apps/mobile-expo run build:android:aab:local
```

也可以通过环境变量显式指定凭据：

```bash
ANDROID_KEYSTORE_PATH="/secure/path/xopc-upload.jks" \
ANDROID_KEYSTORE_PASSWORD="..." \
ANDROID_KEY_ALIAS="..." \
ANDROID_KEY_PASSWORD="..." \
pnpm -C apps/mobile-expo run build:android:local
```

输出位置：

```text
apps/mobile-expo/dist/android/xopc-android.apk
apps/mobile-expo/dist/android/xopc-android.aab
```

脚本会运行干净的 Expo Android prebuild，因此不要把临时生成的 `apps/mobile-expo/android/` 当作长期手工维护的源文件。

### Android 凭据（仅首次配置或轮换时）

Actions 使用两套独立 Secrets：

```text
ANDROID_PREVIEW_KEYSTORE_BASE64
ANDROID_PREVIEW_KEYSTORE_PASSWORD
ANDROID_PREVIEW_KEY_ALIAS
ANDROID_PREVIEW_KEY_PASSWORD
ANDROID_PRODUCTION_KEYSTORE_BASE64
ANDROID_PRODUCTION_KEYSTORE_PASSWORD
ANDROID_PRODUCTION_KEY_ALIAS
ANDROID_PRODUCTION_KEY_PASSWORD
```

需要恢复或轮换凭据时：

```bash
pnpm -C apps/mobile-expo exec eas credentials -p android
```

分别选择 Preview/Production 对应的 Build Profile，将远端凭据下载到本机，再把 keystore 文件编码为单行 Base64，并用 `gh secret set` 更新对应 Secrets。Production 示例：

```bash
base64 < /secure/path/xopc-upload.jks | tr -d '\n' | \
  gh secret set ANDROID_PRODUCTION_KEYSTORE_BASE64
gh secret set ANDROID_PRODUCTION_KEYSTORE_PASSWORD
gh secret set ANDROID_PRODUCTION_KEY_ALIAS
gh secret set ANDROID_PRODUCTION_KEY_PASSWORD
```

Preview 使用同样方式更新 `ANDROID_PREVIEW_*`。不要在终端输出、文档、Issue 或提交中粘贴密码和 keystore 内容。

必须长期保留 Production keystore。随意更换后，旧安装包通常无法覆盖升级，Google Play 也会拒绝错误 upload key 签名的更新。

## iOS / TestFlight

### GitHub Actions 一键发布

1. 打开 [Mobile iOS TestFlight](https://github.com/xopcai/xopc/actions/workflows/mobile-expo-ios-testflight.yml)。
2. 点击 `Run workflow`，选择要发布的分支。
3. 设置 `upload`：

   - `true`：构建并上传 TestFlight，日常发布选择此项。
   - `false`：只构建、签名和校验 IPA，不上传 Apple。

4. 等待 `Lint, typecheck & tests` 和 `Build and upload signed iOS IPA` 两个 Job 变绿。

成功后会生成 `xopc-ios-production` Artifact，包含 `xopc.ipa`，保留 30 天。`upload=true` 时，日志中出现以下内容表示 Apple 已接收：

```text
No errors uploading archive at 'dist/xopc.ipa'.
```

随后打开 [App Store Connect / TestFlight](https://appstoreconnect.apple.com/apps/6772332549/testflight/ios) 等待 Apple 处理。上传成功不等于立即可测试，处理完成后才能分配内部或外部测试人员。

iOS 工作流在 GitHub `macos-26` Runner 上使用 Xcode 26.6，签名范围包括：

- 主 App：`ai.xopc.xopc`
- Share Extension：`ai.xopc.xopc.ShareIntake`
- Widget Extension：`ai.xopc.xopc.ExpoWidgetsTarget`

IPA 上传前会执行 ZIP 完整性、Bundle ID、版本号和 `codesign` 校验。

### iOS 本机一键发布

本机必须是 macOS，并已安装 Xcode、CocoaPods、Node.js 22 和 pnpm。Apple Distribution 证书及三个 Provisioning Profile 也必须能被本机 Xcode 使用。

设置 App Store Connect API Key 后运行：

```bash
export APP_STORE_CONNECT_API_KEY="<KEY_ID>"
export APP_STORE_CONNECT_API_ISSUER="<ISSUER_ID>"
export APPLE_TEAM_ID="<TEAM_ID>"
export APP_STORE_CONNECT_PRIVATE_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8"

pnpm run mobile:release:ios:testflight
```

只构建 IPA，不上传：

```bash
UPLOAD_TO_TESTFLIGHT=0 pnpm run mobile:release:ios:testflight
```

输出为 `apps/mobile-expo/dist/xopc.ipa`。默认使用当前时间生成唯一 iOS Build Number；需要固定值时可设置 `IOS_BUILD_NUMBER=123`。Apple 不允许同一版本重复上传相同 Build Number。

如果 IPA 已经存在，也可以单独上传：

```bash
pnpm -C apps/mobile-expo run submit:ios:direct
```

### iOS 凭据（仅首次配置或续期时）

工作流需要以下 Secrets：

```text
APPLE_TEAM_ID
APP_STORE_CONNECT_API_KEY
APP_STORE_CONNECT_API_ISSUER
APP_STORE_CONNECT_PRIVATE_KEY_BASE64
IOS_DISTRIBUTION_CERTIFICATE_BASE64
IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_MAIN_BASE64
IOS_PROVISIONING_PROFILE_SHARE_BASE64
IOS_PROVISIONING_PROFILE_WIDGET_BASE64
```

证书或 Profile 过期时，先用 EAS 管理并下载三套 Production Build Credentials：

```bash
pnpm -C apps/mobile-expo exec eas credentials -p ios
```

在交互菜单中：

1. 选择 `production` Profile。
2. 进入 `Build Credentials`。
3. 对主 App、`ShareIntake` 和 `ExpoWidgetsTarget` 选择 `All: Set up all the required credentials to build your project`，确保三个 Target 都有有效的 Distribution Certificate 和 Provisioning Profile。
4. 返回凭据菜单，选择 `credentials.json: Upload/Download credentials between EAS servers and your local json`，把凭据下载到 `apps/mobile-expo/credentials.json`。
5. 从仓库根目录同步证书和三个 Profile 到 GitHub：

   ```bash
   pnpm run mobile:configure:ios:github
   ```

同步脚本会校验三个 Profile 的 Bundle ID，并通过 GitHub CLI 加密写入 Secrets，不会把证书或密码提交到仓库。

App Store Connect API Key 不包含在上述 EAS 下载中。需要在 App Store Connect 创建或轮换 API Key 后，分别更新 Key ID、Issuer ID 和私钥：

```bash
gh secret set APP_STORE_CONNECT_API_KEY
gh secret set APP_STORE_CONNECT_API_ISSUER
base64 < /secure/path/AuthKey_<KEY_ID>.p8 | tr -d '\n' | \
  gh secret set APP_STORE_CONNECT_PRIVATE_KEY_BASE64
gh secret set APPLE_TEAM_ID
```

Apple `.p8` 私钥通常只能下载一次，应存放在安全的密码库或加密备份中。

## 版本与产物规则

- App 营销版本来自 `apps/mobile-expo/app.json` 的 `expo.version`。
- Android `versionCode` 位于同一文件，由 `mobile:release:patch` 自动递增。
- iOS Build Number 默认使用 `YYYYMMDDHHmm` 时间戳，避免 TestFlight 重复构建号。
- 手动 Actions 构建不会修改版本文件；要发布新营销版本，使用 `mobile:release:patch` 或先手工更新并提交版本。
- Actions Artifact 默认保留 30 天，不应把它当作唯一长期备份。

## 常见问题

### Android 报 `Missing Android keystore secret`

对应 Profile 的 `ANDROID_PREVIEW_*` 或 `ANDROID_PRODUCTION_*` Secrets 不完整。检查名称并重新上传，不要把 Production 和 Preview 的密码混用。

### Android 已安装 App 无法覆盖升级

通常是包名或签名 keystore 不一致。确认使用 `ai.xopc.xopc`，并使用此前发布版本相同的 Production keystore。

### iOS 报 Provisioning Profile 不匹配

三个 Target 必须分别有与 Bundle ID 完全匹配的 App Store Profile。重新运行 EAS credentials 配置及下载，然后执行：

```bash
pnpm run mobile:configure:ios:github
```

### iOS 上传成功但 TestFlight 看不到

先确认日志包含 `No errors uploading archive`，再到 App Store Connect 等待 Processing。若 Apple 后续通过邮件报告合规或二进制问题，以 App Store Connect 中的状态为准。

### GitHub Actions 构建的不是最新代码

手动运行时确认选择了正确分支，并在 Run 页面核对 Commit。构建期间产生的新提交不会自动进入已经开始的 Run，需要在新提交推送后重新触发。

## 相关实现

- Android workflow：`.github/workflows/mobile-expo-release.yml`
- iOS workflow：`.github/workflows/mobile-expo-ios-testflight.yml`
- Android 本地构建：`scripts/apps/mobile-expo/build-android-release.sh`
- iOS 本地构建：`scripts/apps/mobile-expo/build-ios-ipa.sh`
- iOS TestFlight 发布：`scripts/apps/mobile-expo/release-ios-testflight.sh`
- iOS 凭据同步：`scripts/apps/mobile-expo/configure-ios-github-secrets.sh`
- 双端 Patch 发布：`scripts/apps/mobile-expo/release-patch.sh`
