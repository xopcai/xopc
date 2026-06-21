# 移动端 app

需要在 iOS 或 Android 上继续使用同一个 xopc 助手时，使用 **[xopc-app](https://github.com/xopcai/xopc-app)**。

xopc-app 是独立的 Expo / React Native 网关客户端。它不会替代 gateway：它连接到已经运行的 xopc gateway，通过 LAN、FRP 或你自己的 HTTPS 反向代理访问，并使用同一套 gateway Bearer token / 配对流程。

## 最短路径

1. 启动 gateway：

```bash
xopc gateway
```

2. 选择手机如何访问 gateway：

| 场景 | 推荐路径 |
| --- | --- |
| 手机和 gateway 在同一 Wi-Fi | 局域网 gateway URL |
| 离开本地网络，需要临时公网 URL | FRP 公网隧道 |
| 你有自己的域名和 TLS 证书 | 反向代理 |
| 所有设备都在 Tailscale | Tailscale Serve |

3. 打开 **Gateway 控制台 → 设置 → 远程访问**。
4. 使用 **Mobile app pairing / 移动端配对** 扫 QR，或复制配对链接。
5. 打开 xopc-app，在设置里确认 gateway base URL / token。

## Gateway 访问方式

### 局域网

手机和 gateway 主机在同一 Wi-Fi 时使用局域网。

- Gateway 可能需要绑定到局域网 IP 或 `0.0.0.0`。
- 使用 token 认证和本地防火墙。
- Android standalone build 需要允许 HTTP cleartext；xopc-app 已在原生构建配置里启用。
- iOS standalone build 需要本地网络权限；首次访问时允许 iOS 的 xopc 本地网络弹窗。

### FRP 公网隧道

离开本地网络或 tailnet，需要临时 HTTPS URL 时使用公网隧道。

- 打开 **远程访问 → 公网访问**。
- 启动隧道并等待公网 URL。
- 扫描 **移动端配对** QR。
- 不再需要远程访问时停止隧道。

公网隧道风险较高：持有公网 URL 或配对 QR 的人，如果同时拿到 Bearer token，就可能访问你的 gateway。

### 反向代理

已有 HTTPS 域名时使用，例如 `https://gateway.example.com`。

- 反向代理终止 TLS，并转发到 loopback gateway。
- Gateway 仍然使用自己的 Bearer token 鉴权。
- 移动端需要系统信任的 TLS 证书；app 路径不支持自签证书。

## 构建 xopc-app

移动端 app 在独立仓库：

```bash
git clone https://github.com/xopcai/xopc-app.git
cd xopc-app
pnpm install
pnpm start
```

xopc-app 仓库里的常用命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm start` | Expo dev server |
| `pnpm run android` / `pnpm run ios` | 开发构建 |
| `pnpm run android:release` | Android release APK |
| `pnpm run typecheck` | TypeScript 检查 |
| `pnpm run test:gateway-sse-client` | SSE client 测试 |

`react-native-mmkv` 使用原生代码。Expo Go 可用内存存储兜底运行，但持久化设置需要 development build 或 standalone build。

## 更多

- [xopc-app 仓库](https://github.com/xopcai/xopc-app)
- [远程访问](./remote-access.md)
- [FRP 隧道安全](../tunnel-security.md)（英文）

