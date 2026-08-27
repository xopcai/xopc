# 磁盘目录

面向用户的路径说明、备份和隐私注意事项见[数据和文件位置](./workspace.md)。

快速参考：

| 区域 | 默认位置 |
| --- | --- |
| 状态目录 | `~/.xopc/` |
| 配置 | `~/.xopc/xopc.json` |
| 本地数据库 | `~/.xopc/xopc.db` |
| 凭据 | `~/.xopc/credentials/` |
| Agent Profile | `~/.xopc/agents/<id>/profile/` |
| Agent 工作区 | 默认 `~/.xopc/workspace/<id>/`，可另行配置 |
| 日志 | `~/.xopc/logs/` |

使用 `xopc profile list`、`xopc config path` 和 `xopc config show` 确认实际位置。不要手动编辑数据库或凭据存储。
