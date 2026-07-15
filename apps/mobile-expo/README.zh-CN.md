# xopc Mobile

[English](./README.md) | 简体中文

[xopc](https://github.com/xopcai/xopc) gateway 的 Expo 移动客户端。App 通过 HTTP/WebSocket 连接用户自托管 gateway，支持 LAN 优先路由，并可在 QR 配对后通过 FRP 远程访问。

移动端定位为克制、内容优先的工作空间，用于笔记、收件整理、助手会话与自动化控制。视觉与交互规范见 [DESIGN.md](./DESIGN.md)。

## 快速链接

- 主项目：[xopcai/xopc](https://github.com/xopcai/xopc)
- 移动端指南：[xopc docs - Mobile app](https://xopcai.github.io/xopc/mobile-app)
- 远程访问指南：[xopc docs - Remote access](https://xopcai.github.io/xopc/remote-access)
- 设计规范：[DESIGN.md](./DESIGN.md)

如果 xopc 帮你在终端、Web、桌面、移动端和消息渠道中持续推进长期 AI 工作，欢迎给主仓库点 Star：[github.com/xopcai/xopc](https://github.com/xopcai/xopc)。

## App 如何连接

1. 在保存 xopc 配置和模型凭据的机器上启动 `xopc gateway`。
2. 打开 gateway 控制台，进入 **Settings -> Remote access**。
3. 选择连接方式：LAN、FRP 公网隧道、Tailscale Serve，或你自己的 HTTPS 反向代理。
4. 在移动端扫描 gateway QR 码配对，或在 App 设置中手动填写 gateway base URL 和可选 bearer token。

远程访问采用 LAN 优先路由。启用 FRP 后，`*.frp.xopc.ai` 由 broker 终止 TLS；QR 配对后，远程 API 调用使用 HTTPS 加 gateway bearer token。

## 技术栈

| 领域 | 选型 |
|---|---|
| 运行时 | Expo SDK 56, React Native 0.85, React 19 |
| 路由 | Expo Router |
| 服务端状态 | TanStack React Query |
| 客户端状态 | Zustand |
| 存储 | react-native-mmkv，Expo Go 环境使用内存 fallback |
| UI | react-native-paper 加项目设计 token |
| 手势与动画 | react-native-gesture-handler, react-native-reanimated |
| 键盘 | react-native-keyboard-controller |
| 列表 | 长列表和高频更新列表使用 FlashList |
| 校验 | zod, react-hook-form |
| 测试 | Vitest |

## 仓库结构

```text
app/                         Expo Router 路由
src/                         Feature、组件、API、query、theme、store
src/theme/                   设计 token 与 Paper theme 映射
src/i18n/                    本地化消息包
src/storage/                 MMKV 与 fallback 存储
../../packages/gateway-sse-client/ gateway SSE 解析工作区包
plugins/                     Expo config plugins
app.json                     Expo 原生配置
eas.json                     EAS 构建 profile
```

## 环境要求

- Node.js 22+
- 仓库根 `packageManager` 指定的 pnpm 版本
- 真机使用需要运行中的 xopc gateway
- iOS 原生构建需要 Xcode 和 CocoaPods
- Android 原生构建需要 Android Studio / Android SDK

## 安装

```bash
pnpm install
```

## 开发

```bash
pnpm run dev:mobile
```

常用脚本：

| 脚本 | 说明 |
|---|---|
| `pnpm run dev:mobile` | 启动 Expo dev server |
| `pnpm -C apps/mobile-expo run start:no-proxy` | 清空代理环境变量后启动 Expo |
| `pnpm run android:mobile` | 构建并运行 Android |
| `pnpm run ios:mobile` | 构建并运行 iOS |
| `pnpm -C apps/mobile-expo run ios:no-proxy` | 清空代理环境变量后构建并运行 iOS |
| `pnpm run mobile:lint` | 对 `app` 和 `src` 运行 ESLint |
| `pnpm run mobile:typecheck` | 类型检查 App 与 SSE 工作区包 |
| `pnpm run mobile:test` | 运行 Vitest 测试 |
| `pnpm run mobile:test:sse` | 运行 SSE client 测试 |

## 配置 Gateway

在 App 设置中配置：

- Gateway base URL，不要带结尾斜杠。
- 可选 bearer token，需要与 `xopc.json` 中的 gateway auth 匹配。

示例：

```text
http://192.168.1.44:18790
https://your-name.frp.xopc.ai
https://xopc.example.com
```

App 可在 gateway 设置中探测可用路由，并在 `/health` 成功时优先使用 LAN。

## Expo Go 与 Development Build

Expo Go 适合快速 UI 迭代，但它不包含本 App 使用的全部原生模块。

`react-native-mmkv` 需要原生代码。在 Expo Go 中，App 会降级到内存存储，因此重启后设置会丢失。需要持久化存储和真实原生网络行为时，请使用 development build：

```bash
pnpm -C apps/mobile-expo exec expo prebuild
pnpm -C apps/mobile-expo run ios:no-proxy
# 或
pnpm run android:mobile
```

修改 `app.json`、config plugin、原生权限或原生网络设置后，请运行 `pnpm -C apps/mobile-expo exec expo prebuild --clean`。

## 推送通知

App 通过 Expo Push Service 发送任务提醒。完成 gateway 配对后，在 App 设置中开启**任务通知**；仅在这次显式操作时请求系统权限，并把 Expo token 注册到 gateway。点击通知会打开对应聊天或自动化页面。

Gateway 会在本地 SQLite 中保存设备注册信息，并为“目标需要输入”“目标阻塞”和自动化失败发送提醒。完成类提醒默认关闭，可通过设备偏好 API 开启。

发布构建前，请在各平台账号中完成以下配置（不要提交凭据或凭据文件）：

1. 在 Expo/EAS 中确认项目 ID 与 `app.json` 相同，并使用 development 或 production client 测试；Android 的 Expo Go 不能作为推送通知测试目标。
2. Android：在 Firebase 创建包名为 `ai.xopc.xopc` 的 Android App，并在 Expo 项目凭据中配置 FCM v1。`google-services.json` 必须留在 Git 之外。
3. iOS：在 Apple Developer 中为 `ai.xopc.xopc` 开启 Push Notifications，并在 EAS 凭据中配置 APNs key 或 profile；请在真机 iPhone/iPad 上测试。
4. 确认 gateway 主机可通过 HTTPS 访问 `https://exp.host`；手机仍通过已配对的 LAN 或远程 URL 访问 gateway。

首次完成凭据配置、或变更原生通知配置后，需要重新构建：

```bash
pnpm -C apps/mobile-expo exec expo prebuild --clean
pnpm -C apps/mobile-expo run build:android:preview
pnpm -C apps/mobile-expo run build:ios:preview
```

## 原生网络说明

本地 gateway 通常在 LAN IP 上使用普通 HTTP，例如 `http://192.168.1.44:18790`。Expo Go 与已安装的原生构建行为可能不同，因为原生构建使用本 App 自己的 bundle ID、权限和网络策略。

### Android HTTP Cleartext

Android 9+ 默认阻止 HTTP。本项目通过 `expo-build-properties` 设置 `android.usesCleartextTraffic: true`，允许 LAN HTTP。

修改原生网络设置后：

```bash
pnpm -C apps/mobile-expo exec expo prebuild --clean
pnpm run android:mobile
```

如果 LAN 在 Expo Go 中可用，但在 dev-client 或 release APK 中失败，请重新构建 Android App。Cleartext 设置在 prebuild 阶段写入。

### iOS Local Network 与 ATS

`app.json` 中的 iOS 配置包含：

- `NSAppTransportSecurity.NSAllowsLocalNetworking`，允许访问本地 IP 的 HTTP。
- `NSLocalNetworkUsageDescription`，用于 iOS Local Network 隐私弹窗。

首次访问 LAN 时，iOS 会询问是否允许 App 查找本地网络设备。Expo Go 与已安装的 xopc App 使用不同 bundle ID；允许 Expo Go 不等于允许独立 App。

安装后如果 LAN 不可达：

1. 打开 **Settings -> Privacy & Security -> Local Network**，启用 **xopc**。
2. 确认手机和 gateway 在同一个 Wi-Fi。
3. 在 App gateway 设置中重新探测路由。

## iOS CocoaPods 与代理说明

如果 `expo run:ios` 卡在 `Installing CocoaPods...`，系统 HTTP 代理可能会拖慢 `pod install`，并触发 Node `[UNDICI-EHPA]` 警告。

本仓库提供：

- `plugins/with-ios-cocoapods-mirror.js`，在 prebuild 时注入清华 CocoaPods Specs 镜像。
- 清空代理环境变量并优先使用 Homebrew `pod` 的脚本。

推荐流程：

```bash
pnpm -C apps/mobile-expo exec expo prebuild
pnpm run pods:install
pnpm -C apps/mobile-expo run ios:no-install
```

一步执行：

```bash
pnpm -C apps/mobile-expo run ios:no-proxy
```

## Android Release 构建

Release 构建使用 `expo-build-properties` 控制安装体积：

- 仅 `arm64-v8a`。
- 启用 R8 minification。
- 启用 resource shrinking。

构建本地 release APK：

```bash
pnpm -C apps/mobile-expo exec expo prebuild --clean
pnpm -C apps/mobile-expo run android:release
```

EAS profile：

| 脚本 | 产物 |
|---|---|
| `pnpm -C apps/mobile-expo run build:android:preview` | 内部分发 Android APK |
| `pnpm -C apps/mobile-expo run build:android:production` | Android App Bundle |
| `pnpm -C apps/mobile-expo run build:ios:preview` | 内部分发 iOS build |
| `pnpm -C apps/mobile-expo run build:ios` | 本地生产 iOS IPA，默认输出 `dist/xopc.ipa` |
| `pnpm -C apps/mobile-expo run build:ios:eas` | EAS 生产 iOS build |
| `pnpm -C apps/mobile-expo run submit:ios` | 提交最新生产 iOS build |
| `pnpm -C apps/mobile-expo run submit:ios:direct` | 直接上传本地 `dist/xopc.ipa`，也可传 IPA URL 或本地路径 |

本地 iOS 构建示例：

```bash
DEVELOPMENT_TEAM="TEAMID1234" pnpm -C apps/mobile-expo run build:ios
pnpm -C apps/mobile-expo run submit:ios:direct
```

`build:ios` 默认用当前时间生成 iOS build number；需要固定值时可传 `IOS_BUILD_NUMBER=123`。

如需让 Xcode 自动拉取签名配置，可复用提交脚本的 App Store Connect API Key 环境变量：

```bash
APP_STORE_CONNECT_API_KEY="KEY_ID" \
APP_STORE_CONNECT_API_ISSUER="ISSUER_ID" \
DEVELOPMENT_TEAM="TEAMID1234" \
pnpm -C apps/mobile-expo run build:ios
```

当前 package ID 是 `ai.xopc.xopc`。如果之前安装过 `com.anonymous.xopcapp` 的构建，需要单独卸载；Android 会把它当作另一个 App。

## 质量检查

交付改动前建议运行：

```bash
pnpm run mobile:lint
pnpm run mobile:typecheck
pnpm run mobile:test
```

如果改动了 `packages/gateway-sse-client`，还需要运行：

```bash
pnpm run mobile:test:sse
```

## License

MIT，与 xopc 主仓库保持一致，除非另有说明。
