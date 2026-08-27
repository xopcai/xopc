# 数据和文件位置

xopc 把本机状态保存在一个目录中，并为每个 Agent 提供独立工作文件夹。理解两者差异有助于备份、隐私检查和故障排查。

## 默认位置

默认状态目录是 `~/.xopc/`。

| 路径 | 内容 | 处理方式 |
| --- | --- | --- |
| `~/.xopc/xopc.json` | 主配置 | 私密；可能引用凭据和网络设置 |
| `~/.xopc/xopc.db` | Session、用户上下文、Automation 等本地记录 | 私密且需要备份 |
| `~/.xopc/credentials/` | API、OAuth、消息通道和配对凭据 | 密钥 |
| `~/.xopc/agents/<id>/profile/` | Agent 身份和指令 Markdown | 用户可编辑，通常私密 |
| `~/.xopc/workspace/<id>/` | Agent 使用和创建的文件 | 用户数据 |
| `~/.xopc/skills/` | 已安装 Skill | 信任前检查 |
| `~/.xopc/extensions/` | 已安装扩展 | 信任前检查 |
| `~/.xopc/logs/` | 运行和诊断日志 | 可能含私人元数据 |
| `~/.xopc/tools/` | 托管 Node.js 和 Python 环境 | 可以重建的运行数据 |

Agent 可以配置其它工作区路径，因此请通过 Agent 编辑页或 `xopc config show` 确认，不要只假设默认位置。

## 状态、Agent Profile 与工作区

- **状态** 包括本地数据库、配置、凭据、日志和已安装能力。
- **Agent Profile** 描述 Agent 的身份和行为。
- **工作区** 存放 Agent 工作时读取和创建的文件。

不要在工作区保存模型密钥，也不要用工作区 Markdown 代替本地 Session 数据库。

## 查找当前路径

```bash
xopc profile list
xopc config path
xopc config show
```

Profile 可能使用 `~/.xopc-work` 等目录。环境变量和命令行参数也能覆盖路径。

## 备份

为了获得一致的完整备份：

1. 停止或暂停进行中的 Agent 运行和 Automation；
2. 停止 Gateway 服务；
3. 把当前状态目录复制到加密存储；
4. 单独包含位于状态目录外的 Agent 工作区；
5. 重启 Gateway 并验证健康状态。

备份中包含凭据和私人对话。必须加密、限制访问并设置保留时间。

恢复前保留当前状态副本，使用兼容 xopc 版本，并确认文件所有权正确。不要手动合并 SQLite 文件。

## 安全手动编辑

通常可以编辑 Agent Profile Markdown 和普通工作区文件。配置、凭据、Session、Automation、Skill 和扩展请使用 xopc 命令或界面。

不要手动编辑 `xopc.db`、锁文件、凭据存储或托管运行环境中的文件。

## 迁移或隔离状态

需要可复用独立环境时使用 `xopc profile` 的子命令。高级路径覆盖包括 `XOPC_STATE_DIR`、`XOPC_CONFIG_PATH`、`XOPC_WORKSPACE`、`XOPC_CREDENTIALS_DIR` 和 `XOPC_LOG_DIR`。

系统服务或容器中使用绝对路径，并确认服务账号有读写权限。
