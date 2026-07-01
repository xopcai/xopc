# PC 桌面端

PC 桌面端是大多数用户最省心的开始方式。它会自动启动本地 xopc gateway，在原生窗口中打开网关控制台，并让你在界面里完成模型、Agent、记忆、频道、日志和更新等配置，不需要一直开着终端。

如果你想以桌面应用的方式安装和使用 xopc，请按本文操作。偏终端的用户可以看 [5 分钟快速入门](./first-5-minutes.md)。

## 快速路径

1. 打开 [GitHub Releases](https://github.com/xopcai/xopc/releases)。
2. 下载当前平台对应的安装包。
3. 安装并启动 **xopc**。
4. 在应用里完成模型设置。
5. 打开 **Chat**，发送一条简短测试消息。

| 平台 | 安装包 |
| --- | --- |
| macOS | `.dmg` |
| Windows | `xopc-<version>-x64.exe` 或 `xopc-<version>-arm64.exe` |
| Linux | `.AppImage` 或 `.deb` |

::: tip
第一次使用时，先配置一个可用的模型服务商。确认聊天跑通后，再开启频道、浏览器工具、手机端配对或额外 Agent，这样更容易定位问题。
:::

## 你会得到什么

- **安装后不必一直操作终端**：打开应用，完成模型设置，就能开始聊天。
- **内置 gateway**：应用会在本机 loopback 端口启动 gateway 子进程；可用时通常从 `28790` 开始。
- **配置更可见**：模型、Agent、频道、记忆、日志、更新都在控制台 UI 里。
- **仍然本地优先**：桌面端配置和工作区数据保存在系统应用数据目录中，不依赖 xopc 云服务。
- **同一套产品界面**：桌面窗口加载的是 `xopc gateway` 使用的同一个网关控制台。

## 首次使用

### 1. 安装应用

从最新 Release 下载你的系统对应的安装包，然后按系统习惯安装。

- macOS：打开 `.dmg`，把 xopc 拖到 Applications。
- Windows：运行 `.exe` 安装包。
- Linux：直接运行 `.AppImage`，或安装 `.deb`。

### 2. 打开 xopc

从应用菜单启动 xopc。应用会在后台启动本地 gateway，然后加载控制台。

如果出现 gateway 启动错误，先关闭旧的 xopc 桌面窗口后重启。仍然失败时，参考 [排障](#排障)。

### 3. 配置模型

进入模型或凭据设置页面，先添加一个服务商。推荐默认路径是使用 DeepSeek，并配置 `deepseek/deepseek-v4-flash`。

桌面端支持通过界面配置不同凭据来源：

| 凭据方式 | 适合场景 |
| --- | --- |
| OAuth | 服务商支持从控制台发起浏览器登录 |
| API Key | 你希望在应用里粘贴并保存服务商密钥 |
| 环境变量 | 你已经通过 `DEEPSEEK_API_KEY` 等环境变量启动 xopc |

服务商细节见 [模型支持](./models.md) 和 [配置第一个模型](./how-to/configure-first-model.md)。

### 4. 发送第一条消息

打开 **Chat**，保持默认 Agent，发送一条小 prompt，例如：

```text
用三条要点总结 xopc 能帮我做什么。
```

确认回复正常后，再继续设置 Agent、记忆、频道、手机端配对或工作流。

## 日常使用

| 任务 | 入口 |
| --- | --- |
| 开始对话 | **Chat** |
| 切换或编辑 Agent | **Agents** |
| 查看记忆和召回情况 | **Memory** |
| 修改模型凭据 | **Settings -> Credentials** 或模型设置面板 |
| 查看运行问题 | **Settings -> Logs** |
| 接入 Telegram、微信、飞书/Lark | **Channels** |
| 配对手机端 App | **Settings -> Remote access** |
| 更新 xopc | **Settings -> Gateway / Update** 或重新安装 Release 包 |

桌面端可以作为主要的本地控制台。你仍然可以用 `xopc` 进入 TUI，用 `xopc agent -m` 写脚本，或在需要浏览器控制台时手动运行 `xopc gateway`。

## 桌面端 gateway 和 CLI gateway 的关系

桌面端内置 gateway 与命令行 gateway 是刻意分开的。

| 入口 | 默认行为 |
| --- | --- |
| 桌面端 | 启动内嵌 gateway，监听本机 loopback 端口，通常从 `28790` 开始 |
| `xopc gateway` | 启动 CLI 管理的 gateway，使用 CLI gateway 默认端口 |
| `xopc` / `xopc tui` | 进入本地终端界面 |

这样桌面端和手动启动的 gateway 可以并行运行。调试频道或手机端配对时，请先确认你正在使用哪个 URL、token 和配置文件。

## 数据与配置

桌面端会在操作系统的应用数据目录下创建 Electron 管理的配置和工作区。内部主要包含：

- `xopc.json`：桌面端管理的 xopc 配置。
- `workspace/main/`：桌面端默认工作区。

应用启动内嵌 gateway 时，还会设置 `XOPC_CONFIG_PATH`、`XOPC_WORKSPACE`、`XOPC_STATE_DIR` 等运行时环境变量。

如果你想使用经典 CLI 状态目录 `~/.xopc/`，请走终端路径：

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc
```

## 从源码打包

只有在开发 xopc，或当前平台暂时没有 Release 包时，才需要从源码打包。

```bash
pnpm install
pnpm run electron:build
```

产物会输出到 `dist/release/`。

开发模式：

```bash
pnpm run build
pnpm run electron:dev
```

## 素材预留

截图、GIF 或视频文件统一放在 `docs/public/desktop/`。当前文档只预留文件名，不引用不存在的文件，避免页面出现破图。

| 素材 | 文件位置 | 用途 |
| --- | --- | --- |
| 首次启动截图 | `docs/public/desktop/desktop-first-launch.png` | 展示打开应用后的第一个窗口 |
| 模型设置截图 | `docs/public/desktop/desktop-model-setup.png` | 展示 provider/API Key 或 OAuth 设置 |
| 聊天就绪截图 | `docs/public/desktop/desktop-chat-ready.png` | 展示第一次聊天成功 |
| Agent 页面截图 | `docs/public/desktop/desktop-agents.png` | 展示 Agent 切换和编辑入口 |
| Memory 页面截图 | `docs/public/desktop/desktop-memory.png` | 展示记忆和召回查看入口 |
| Settings 页面截图 | `docs/public/desktop/desktop-settings.png` | 展示凭据、gateway、日志和系统设置 |
| 快速上手 GIF | `docs/public/desktop/desktop-quick-start.gif` | 安装/打开/设置/聊天流程 |
| 产品概览视频 | `docs/public/desktop/desktop-overview.mp4` | 可用于文档或 Release 页面 |

补齐文件后，用下面的路径引用：

```md
![桌面端首次启动](/desktop/desktop-first-launch.png)
```

## 排障

- **gateway 启动失败**：关闭旧的 xopc 桌面窗口后重启。应用会尽量从 `28790` 开始选择可用端口。
- **端口冲突**：如果同时运行 `xopc gateway`，先确认你正在使用的是桌面端 gateway 还是 CLI gateway。
- **模型设置失败**：检查服务商密钥或 OAuth 登录状态，再参考 [模型支持](./models.md)。
- **应用打开但控制台空白**：重启应用；受限 Windows 机器可先更新显卡驱动后再试。
- **频道或手机端配对不可用**：确认暴露给手机或消息通道的是桌面端正在使用的 gateway。
