# 前 5 分钟

这页是从“在 GitHub 上看到 xopc”到本地跑起来的最短路径。

如果你只是想先理解产品形态，不想马上配置网页控制台、桌面端、移动端或 IM，用这条路径。

## 1. 安装

macOS、Linux、WSL2、Termux：

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

如果已经有 Node.js 22+：

```bash
npm install -g @xopcai/xopc
```

Windows PowerShell：

```powershell
iex (irm https://xopc.ai/install.ps1)
```

## 2. 只配置模型

```bash
xopc onboard --quick
```

`--quick` 是最短引导路径：选择模型/厂商，保存凭据，暂时跳过网关和频道配置。

你可以自带云端模型 API Key，也可以在配置后使用 Ollama、LM Studio、vLLM 等本地/自部署模型服务。

## 3. 启动本地 TUI

```bash
xopc tui --local
```

这会启动嵌入式终端界面，不需要先启动 gateway。

## 4. 试一个目标循环 prompt

粘贴这句：

```text
帮我持续推进这个 side project 本周的进展。请记录目标、下一步行动、阻塞点，并在每一步之后接住反馈。
```

观察重点：

- xopc 应该把它当作持续目标，而不是一次性回答。
- 本地状态和配置默认在 `~/.xopc/`。
- 你可以先在终端继续，之后再加 Web、移动端或 IM 入口。

## 5. 后续再添加入口

本地路径跑通后，再选择下一个入口：

| 入口 | 命令 | 适合 |
| --- | --- | --- |
| CLI | `xopc agent -i` | 最小终端聊天 |
| 网页控制台 | `xopc gateway` | 浏览器聊天、设置、日志 |
| 桌面端 | GitHub Releases 或 `pnpm run electron:build` | 原生应用 |
| 移动端 | [xopc-app](https://github.com/xopcai/xopc-app) + 网关配对 | iOS/Android 网关客户端；见 [移动端 app](./mobile-app.md) |
| IM | `xopc onboard` 后配置频道 | Telegram、微信、飞书/Lark |

## 如果它有帮助

欢迎给仓库点个 Star，让更多开发者看到 xopc：

https://github.com/xopcai/xopc

完整说明见 [快速开始](./getting-started.md)。
