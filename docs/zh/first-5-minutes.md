# 5分钟快速入门

这篇文档帮你用最短路径从「在 GitHub 上看到 xopc」到「本地开聊」。

如果你只是想先体验核心功能，暂时不想配置网页控制台、桌面端、手机端或即时通讯入口，按下面步骤走即可。

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

## 2. 先只配置模型

```bash
xopc onboard --quick
```

`--quick` 是最短配置流程：选择模型服务商，保存凭据，暂时跳过网关和频道设置。

你可以使用云端模型 API Key，也可以配置 Ollama、LM Studio、vLLM 等本地或自部署模型服务。

## 3. 启动本地 TUI

```bash
xopc tui --local
```

这会直接打开本地终端界面，不需要先启动网关。

你应该看到一个全屏终端聊天界面。如果它立刻退出，先运行 `xopc doctor`，再用 `xopc models status` 检查模型状态。

## 4. 试一条目标循环提示词

粘贴这句：

```text
帮我持续推进这个个人项目本周的进展。请记录目标、下一步行动和阻塞点，并在每一步之后根据我的反馈继续调整。
```

观察重点：

- xopc 应该把它当作持续目标，而不是只给一次性回答。
- 本地状态和配置默认保存在 `~/.xopc/`。
- 你可以先在终端里继续使用，之后再接入网页、手机端或即时通讯入口。

## 5. 后续再添加入口

本地流程跑通后，再按需要选择下一个入口：

| 入口 | 命令 | 适合 |
| --- | --- | --- |
| CLI | `xopc agent -i` | 最小终端聊天 |
| 网页控制台 | `xopc gateway` | 在浏览器中聊天、改设置、看日志 |
| 桌面端 | GitHub Releases 或 `pnpm run electron:build` | 桌面应用 |
| 手机端 | [xopc-app](https://github.com/xopcai/xopc-app) + 网关配对 | iOS/Android 网关客户端；见 [手机端 App](./mobile-app.md) |
| 即时通讯 | `xopc onboard` 后配置频道 | Telegram、微信、飞书/Lark |

## 如果它有帮助

欢迎给仓库点个 Star，让更多开发者看到 xopc：

https://github.com/xopcai/xopc

完整说明见 [快速开始](./getting-started.md)。
