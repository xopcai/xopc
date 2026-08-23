# 智能体工具运行时

xopc 为 Shell、后台任务、stdio MCP 服务和 Skill 依赖统一管理 Node.js 与 Python 环境。它们和运行 xopc 主程序的 Node.js 相互独立。

## 生命周期

- `xopc setup` 和 `xopc onboard` 会初始化策略为 `eager` 的运行时；需要延后或保持离线时可加 `--skip-runtimes`。
- `on-demand` 运行时在 MCP 或 Skill 首次需要时安装。
- Shell 与后台任务使用清理过的环境变量，并把受管二进制目录放到 `PATH` 前面。
- 下载包必须通过校验和验证；解压、探测成功后才切换 active manifest。
- 修复失败会恢复旧安装；`xopc runtime prune` 不会删除当前 active 版本。

## 命令

```bash
xopc runtime status
xopc runtime install node
xopc runtime install python --version 3.12.11
xopc runtime repair python
xopc runtime prune
```

控制台的 **设置 → 工具运行时** 提供状态监察、策略、安装、修复、代理、离线包与清理入口。

## 核心配置

`runtimeTools.node` 和 `runtimeTools.python` 支持以下来源策略：

- `managed-only`：仅使用 xopc 受管环境；
- `managed-first`：受管环境优先，失败时检查系统环境；
- `system-first`：系统环境优先；
- `system-only`：仅使用系统环境。

初始化策略为 `eager`、`on-demand` 或 `disabled`。`disabled` 只禁止自动安装，已经存在且兼容的环境仍可使用。

下载来源可设为 `auto`、`website-only` 或 `direct-only`。`auto` 优先使用经过校验的 xopc.ai 制品网关，只在可重试的网络故障时切换官方上游；描述文件异常和校验失败不会降级。

网关同时代理 uv 固定版本对应的 Python Build Standalone 制品。Node.js 与 uv 下载中断后会保留 `.partial` 文件，并在服务端支持 Range 时断点续传。

## 离线包

把 `runtimeTools.download.bundleDir` 设置为绝对路径后，安装不会回退到网络。每个压缩包必须有同名 `.sha256` 文件，或在 `SHASUMS256.txt` 中提供校验和。

Node.js 与 uv 使用上游文件名。Python 离线包使用 xopc 约定，例如：

```text
python-3.12.11-darwin-arm64.tar.gz
python-3.12.11-darwin-arm64.tar.gz.sha256
```

压缩包只能有一个顶层目录；Unix 下需包含 `bin/python3` 或 `bin/python`，Windows 下需包含 `python.exe`。

所有内容存放在 `~/.xopc/tools`（或 `XOPC_STATE_DIR/tools`）。Skill 的 npm/uv 依赖安装到确定性的 xopc 私有目录，不再写入机器全局包目录。
