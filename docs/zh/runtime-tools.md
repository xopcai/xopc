# 工具运行环境

一些 Agent 工具、Skill 和本地 MCP 服务需要 Node.js 或 Python。xopc 可以管理隔离运行环境，无需全局安装这些依赖。

## 查看状态

打开 **设置 → 工具运行环境**，或运行：

```bash
xopc runtime status
```

状态会显示 Node.js、Python 和相关辅助程序是否就绪，以及当前版本。

## 安装或修复

```bash
xopc runtime install node
xopc runtime install python
xopc runtime repair python
```

没有兼容性理由时，使用 Skill 或工具要求的版本。下载会在成为活动版本前验证。

## 删除旧版本

```bash
xopc runtime prune
```

Prune 会移除不再使用的保留版本，不应删除活动环境。磁盘空间重要时请检查命令输出。

## 安装策略

- **Eager**：设置过程中安装。
- **On demand**：工具第一次需要时安装。
- **Disabled**：禁止自动安装，但可以使用已经存在的兼容环境。

Managed-first 是最简单的默认方式。管理员单独控制运行环境时可使用 system-only。

## 离线或代理环境

在工具运行环境设置中配置网络代理或已验证的离线包目录。离线包必须匹配操作系统和 CPU 架构，并包含校验和。

## 故障排查

- 下载失败：检查代理、DNS、TLS 拦截和磁盘空间。
- 校验和失败：丢弃归档并重新下载，不要绕过验证。
- 工具仍找不到 Python 或 Node.js：重启 Gateway 并检查工具选择的环境。
- 权限不足：确认 Gateway 服务账号拥有或可写 xopc tools 目录。

## 手机控制依赖

「设置 → 手机控制」和「运行环境」共用手机依赖状态卡片。检测不会自动下载；需要时由管理员点击安装或修复，安装位置是 **Gateway 所在机器**。Electron 使用内置 Gateway 时，安装在当前电脑共享的 xopc 状态目录，无需全局安装或完整 Android Studio。

| 依赖 | 用途 | 已有依赖 |
| --- | --- | --- |
| ADB / Android Platform Tools | 本机 USB 手机、模拟器；阿里云 ADB 连接不需要它 | 自动发现 Android SDK，或填写 Gateway 上已有 ADB 可执行文件的绝对路径 |
| scrcpy server | 实时视频和持续触控；未安装时保留截图模式 | 填写 Gateway 上已有 server 文件路径，校验后导入托管目录 |

ADB 自动选择顺序：显式配置路径、已发现的 Android SDK、xopc 托管副本、系统 PATH。已有 SDK 或自定义安装不会被覆盖。切换 ADB 路径或在页面安装、修复 ADB 前，需要关闭当前手机会话；安装器不会主动重启 ADB 或操作手机。

```bash
xopc runtime status --phone
xopc runtime install adb
xopc runtime install scrcpy
xopc runtime repair scrcpy
```

托管版本固定为 Platform Tools 37.0.1、scrcpy server 3.3.3，使用固定 SHA-256 校验。ADB 托管包支持 macOS arm64/x64、Windows x64、Linux x64；其他主机架构可使用自行安装的兼容 ADB。已有 ADB 要求 Platform Tools 31 或更新版本；scrcpy server 必须与固定协议版本及校验和完全一致。

手机依赖复用运行环境的下载代理、超时及离线包目录。离线目录放置对应的官方原始文件：`platform-tools_r37.0.1-darwin.zip`、`platform-tools_r37.0.1-linux.zip` 或 `platform-tools_r37.0.1-win.zip`，以及 `scrcpy-server-v3.3.3`，仍需通过内置固定校验。在线源使用官方 Android / scrcpy 下载地址；设置为 `website-only` 时不会绕过该策略访问官方源，应改用离线包或明确选择 Auto / Direct。

来源和许可：[Android Platform Tools](https://developer.android.com/tools/releases/platform-tools)、[scrcpy 3.3.3](https://github.com/Genymobile/scrcpy/releases/tag/v3.3.3)。安装包中的许可文件会保留。
