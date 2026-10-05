# 原生移动端构建与发布手册

Android 和 iOS 的正式发布入口均已切换到原生项目：

- Android：`apps/mobile-android`，Kotlin + Jetpack Compose
- iOS：`apps/mobile-ios`，SwiftUI + XcodeGen

`apps/mobile-expo` 暂时只作为迁移期回滚与功能参考保留，不再参与默认构建、CI、版本递增或正式发布。旧的 `mobile-expo-v*` 标签和 Expo 发布脚本不得用于新版本。

## 版本与包标识

两个原生应用共用营销版本 `X.Y.Z`，并使用线上包标识 `ai.xopc.xopc`。

- Android 版本位于 `apps/mobile-android/app/build.gradle.kts` 的 `versionName` 和 `versionCode`。
- iOS 版本位于 `apps/mobile-ios/project.yml` 的 `MARKETING_VERSION`；Xcode 项目由 XcodeGen 生成。
- Android `versionCode` 必须持续递增。
- iOS CI 使用 GitHub Run 编号生成唯一 `CFBundleVersion`。

正式标签必须与源码版本一致：

- Android：`mobile-android-vX.Y.Z`
- iOS：`mobile-ios-vX.Y.Z`

## 本地验证

Android：

```bash
pnpm run mobile:android:test
pnpm run mobile:android:build
```

iOS：

```bash
brew install xcodegen swiftformat swiftlint
pnpm run mobile:ios:test
pnpm run mobile:ios:build
```

常规提交由 `.github/workflows/mobile-ios-ci.yml` 检查格式、Lint、XcodeGen 工程同步和单元测试；正式签名仍只发生在 TestFlight 工作流。

共享移动协议客户端：

```bash
pnpm run mobile:test:stream
```

在安装了 Android SDK、Xcode 和上述 iOS 工具的 macOS 发布机上，可以运行双端检查：

```bash
pnpm run mobile:test
```

## Patch 发布

```bash
pnpm run mobile:release:patch
```

发布脚本会：

1. 要求工作树干净，并确认当前分支没有落后或分叉。
2. 验证 Android 单元测试和 Debug 构建。
3. 验证 iOS 格式、Lint、生成工程和单元测试。
4. 验证共享 Agent Stream 客户端。
5. 同步递增 Android/iOS Patch 版本和 Android `versionCode`。
6. 生成并提交 Xcode 工程。
7. 在同一个提交上创建 Android 和 iOS 两个标签。
8. 原子推送分支和两个标签。

两个标签分别触发独立工作流；其中一端失败时，不要再次运行 Patch 发布脚本，否则会错误地产生下一个版本。应修复并重新运行失败的工作流，或在确认发布状态后补齐同一版本。

## Android 正式发布

工作流：`.github/workflows/mobile-android-release.yml`

Android 工作流会：

- 使用现有 `ANDROID_PRODUCTION_*` Secrets 安装生产签名；
- 运行单元测试；
- 构建 APK 和 AAB；
- 校验包名、版本以及固定的生产签名证书；
- 发布 GitHub Release 和 SHA-256 校验文件。

该工作流当前不自动上传 Google Play。上传 Play Console 后，应验证旧 Expo 版本可以升级到原生版本。原生 Android 尚未迁移 Expo 本地数据，升级用户可能需要重新配对。

## iOS TestFlight

工作流：`.github/workflows/mobile-ios-testflight.yml`

iOS 工作流会：

- 拒绝与 `apps/mobile-ios/project.yml` 不一致的标签或手动版本；
- 运行 SwiftFormat、SwiftLint 和单元测试；
- 使用现有主应用证书与 Provisioning Profile；
- 校验 Profile 对应 `${APPLE_TEAM_ID}.ai.xopc.xopc`；
- 归档、签名并验证 IPA；
- 上传构建产物，并在标签发布时上传 TestFlight。

需要以下 GitHub Secrets：

- `APPLE_TEAM_ID`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_MAIN_BASE64`
- `APP_STORE_CONNECT_API_KEY`
- `APP_STORE_CONNECT_API_ISSUER`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`

手动运行工作流且不上传时，可用于验证签名 IPA。正式接管完成的外部证据应至少包括一次成功 TestFlight 上传、真机安装以及从已发布 Expo 版本升级到原生版本的验证。

## 回滚与 Expo 基线

迁移期保留最后一个 Expo 发布标签和源码，但不保留活动 Expo CI 或发布入口。若原生发布出现问题，先停止商店放量；不要从当前主分支重新创建新的 Expo 版本。

完全删除 Expo 前，还需要单独决定 ShareIntake、Widget 和其他未迁移能力的保留或下线策略。
