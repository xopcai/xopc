# 手机端 App

如果你想在 iOS 或 Android 上继续使用同一个 xopc 助手，可以使用 **[xopc 移动端 App](https://github.com/xopcai/xopc/tree/main/apps/mobile-expo)**。

移动端 App 是 Expo / React Native 网关客户端，现在维护在当前仓库的 `apps/mobile-expo` 目录。它不会替代网关，也不会变成另一个云端账号：它连接到已经运行的 xopc 网关，可通过局域网、FRP、Tailscale 或你自己的 HTTPS 反向代理访问，并使用同一套网关 Bearer token / 配对流程。

可以把它理解成你自己的 Agent 的私有远程入口。xopc 仍然运行在你的电脑或自托管环境里；手机负责让你不在键盘前时也能继续对话，或把文字、语音、图片和附件快速记入 Notes。长期上下文仍然留在你的 xopc 运行环境里。

## 最短路径

1. 启动网关：

```bash
xopc gateway
```

2. 选择手机如何访问网关：

| 场景 | 推荐路径 |
| --- | --- |
| 手机和网关在同一 Wi-Fi | 局域网网关 URL |
| 离开本地网络，需要临时公网 URL | FRP 公网隧道 |
| 你有自己的域名和 TLS 证书 | 反向代理 |
| 所有设备都在 Tailscale | Tailscale Serve |

3. 打开 **Gateway 控制台 → 设置 → 远程访问**。
4. 使用 **手机端配对（Mobile app pairing）** 扫码，或复制配对链接。
5. 打开移动端 App，在设置里确认网关地址和 token。

## Gateway 访问方式

### 局域网

手机和网关主机在同一 Wi-Fi 时使用局域网。

- Gateway 可能需要绑定到局域网 IP 或 `0.0.0.0`。
- 使用 token 认证和本地防火墙。
- Android 独立构建需要允许 HTTP 明文访问；移动端 App 已在原生构建配置里启用。
- iOS 独立构建需要本地网络权限；首次访问时请允许 iOS 弹出的 xopc 本地网络权限。

### FRP 公网隧道

离开本地网络或 tailnet，需要临时 HTTPS URL 时使用公网隧道。

- 打开 **远程访问 → 公网访问**。
- 启动隧道并等待公网 URL。
- 扫描 **移动端配对** QR。
- 不再需要远程访问时停止隧道。

公网隧道风险较高：持有公网 URL 或配对二维码的人，如果同时拿到 Bearer token，就可能访问你的网关。

### 反向代理

已有 HTTPS 域名时使用，例如 `https://gateway.example.com`。

- 反向代理终止 TLS，并转发到本机回环地址上的网关。
- Gateway 仍然使用自己的 Bearer token 鉴权。
- 移动端需要系统信任的 TLS 证书；app 路径不支持自签证书。

## 构建移动端 App

手机端 App 位于当前仓库的 `apps/mobile-expo` 目录：

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install
pnpm run dev:mobile
```

仓库根目录里的常用命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm run dev:mobile` | Expo dev server |
| `pnpm run android:mobile` / `pnpm run ios:mobile` | 开发构建 |
| `pnpm -C apps/mobile-expo run android:release` | Android release APK |
| `pnpm run mobile:typecheck` | TypeScript 检查 |
| `pnpm run mobile:test:sse` | SSE client 测试 |

`react-native-mmkv` 使用原生代码。Expo Go 可用内存存储兜底运行，但持久化设置需要 development build 或 standalone build。

## 更多

- [移动端 App 源码](https://github.com/xopcai/xopc/tree/main/apps/mobile-expo)
- [远程访问](./remote-access.md)
- [FRP 隧道安全](../tunnel-security.md)（英文）
