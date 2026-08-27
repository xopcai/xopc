# CLI 命令

不带子命令运行 `xopc` 会打开终端界面。设置、脚本、维护和诊断使用子命令。

## 基础用法

```bash
xopc --help
xopc <command> --help
xopc --version
```

`--config <path>`、`--workspace <path>` 等全局参数只为当前调用选择不同配置或工作区。需要可重复的隔离环境时，优先使用 [Profile](#profile-与路径)。

## 命令概览

| 命令 | 用途 |
| --- | --- |
| `init` | 初始化状态、配置和 Agent 工作区 |
| `setup` | 创建基础配置和工作区 |
| `profile` | 管理独立 xopc 状态 Profile |
| `onboard` | 运行首次设置向导 |
| `channels` | 配置消息通道和配对 |
| `auth` | 管理认证凭据 |
| `agent` | 发送单条消息或开始交互聊天 |
| `tui` | 打开全屏终端界面 |
| `resume` | 恢复之前的 TUI Session |
| `tunnel` | 管理公网隧道访问 |
| `gateway` | 运行和管理 Gateway |
| `session` | 列出和管理 Session |
| `project` | 管理长期 Project |
| `doctor` | 诊断安装、数据和安全问题 |
| `runtime` | 管理 Node.js 与 Python 工具运行环境 |
| `update` | 检查和安装更新 |
| `logs` | 查询和跟踪日志 |
| `config` | 读取、修改和验证配置 |
| `image` | 检查图像服务商可用性 |
| `models` | 列出模型并选择默认值 |
| `providers` | 管理服务商凭据 |
| `voice` | 配置文字转语音 |
| `search` | 配置网页搜索服务商 |
| `skills` | 安装、配置、审计和测试 Skill |
| `connectors` | 浏览和安装连接器能力 |
| `tailscale` | 查看 Tailscale 访问状态 |
| `browser` | 管理浏览器自动化和依赖 |
| `agents` | 创建、列出和移除 Agent |
| `extensions` | 安装和管理扩展 |

具体参数和示例以当前安装版本的 `xopc <command> --help` 为准。

## 常用任务

```bash
# 首次设置
xopc onboard --quick

# 开始或发送聊天
xopc
xopc agent -m "总结这个文件夹"

# 模型状态
xopc providers list
xopc models status

# Gateway
xopc gateway
xopc gateway health

# 配置与诊断
xopc config validate
xopc doctor
xopc logs tail
```

## Profile 与路径

Profile 为不同场景隔离状态、Agent、凭据和 Session。使用 `xopc profile --help` 查看创建和选择方式。命令看起来使用了不同数据时，先确认：

```bash
xopc profile list
xopc config path
```

## 脚本输出

脚本中优先使用支持 `--json` 的命令，检查退出状态，不要解析面向用户的表格，也不要输出未隐藏凭据。通过具体命令的 `--help` 确认是否支持 JSON。

## 安全

- 删除、清理、Token 轮换和更新操作前阅读确认提示。
- 共享系统上避免把敏感信息直接放在命令行参数中。
- 执行外部副作用前确认当前 Profile、Agent、工作区和 Gateway。
- 以已安装版本的 `--help` 为准；在线文档可能对应更新版本。
