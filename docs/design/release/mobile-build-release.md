# 原生移动端构建与发布手册

Android 和 iOS 的正式发布入口均已切换到原生项目：

- Android：`apps/mobile-android`，Kotlin + Jetpack Compose
- iOS：`apps/mobile-ios`，SwiftUI + XcodeGen

旧跨端移动工程已经退役并从仓库移除，不再参与构建、CI、版本递增或正式发布。

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


## Android 正式发布



- 使用现有 `ANDROID_PRODUCTION_*` Secrets 安装生产签名；
- 运行单元测试；
- 构建 APK 和 AAB；
- 校验包名、版本以及固定的生产签名证书；
- 发布 GitHub Release 和 SHA-256 校验文件。


## iOS TestFlight



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


## 回滚基线

原生发布出现问题时，先停止商店放量，并从已发布的原生标签修复；不再恢复已退役的跨平台客户端。未迁移能力后续按产品优先级在原生端重新实现。
