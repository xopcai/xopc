# 备份与恢复 xopc

`xopc backup` 可以为已停止运行的 xopc 状态目录创建加密、可校验的备份。这是将实例迁往其它电脑的基础能力；自动上云、客户端切换和域名切换仍处于设计阶段。

## 开始前

1. 用 `xopc profile list` 和 `xopc config path` 确认当前状态目录。
2. 停止 Gateway 和所有使用该数据库的 xopc 进程。等待正在运行的 Agent 任务和 Automation 结束，或明确将其停止。
3. 在状态目录之外准备口令文件。使用至少 12 个字符的独立强口令；Unix 上运行 `chmod 600 /secure/passphrase`。口令文件应与备份分开保管。
4. 在状态目录之外选择一个**尚不存在**的输出目录，并确保其父目录已存在。

## 创建与校验

```bash
xopc backup create --output /secure/xopc-backup --passphrase-file /secure/passphrase
xopc backup verify /secure/xopc-backup --passphrase-file /secure/passphrase
```

如果检测到其它进程仍打开数据库，`create` 会拒绝执行。它先生成一致的 SQLite 快照，再以 AES-256-GCM 加密纳入备份的文件和清单。`verify` 校验认证标签、文件哈希和 SQLite 完整性。Unix 上备份目录和文件只允许所有者访问。

备份包含**当前状态目录内**的数据库、配置、凭据、Agent Profile、已安装的 Skill 和扩展、附件及工作区。日志、缓存、下载的工具运行时和进程临时文件不在其中。手机端尚未发送到 Gateway 的草稿和离线操作也不在服务器备份中。

本版本会拒绝**已知的**状态目录外配置、凭据或 Agent 工作区路径，避免生成看似完整的备份；自定义扩展使用的所有外部路径尚无法自动发现。如果命令报告外部路径，需单独备份并检查目标机器上的路径引用，不能将这些文件当成已验证的一键迁移结果。

## 恢复

```bash
xopc backup restore /secure/xopc-backup --target /new/.xopc --passphrase-file /secure/passphrase
```

目标目录必须不存在。恢复先写入临时目录，逐个校验文件和 SQLite，全部成功后才发布目录。失败时会清理临时文件，也不会覆盖已有状态目录。

启动恢复后的 Gateway 前，先使用兼容的 xopc 版本，并检查绝对路径、文件所有权、外部工作区、OAuth 回调、通道凭据、设备配对和公网 URL。部分与原设备绑定的凭据需要重新授权。启用恢复实例时，让旧实例保持停止，避免通道和 Automation 重复运行。

## 升级与 Docker

安装可能迁移数据库的新版本前，先创建并校验备份。数据库已经被新版本升级后，只回退旧应用程序并不安全；应把对应的升级前备份恢复到新目录。参见[更新 xopc](./update.md)。

使用 Docker 时先停止 Gateway 容器，再把持久状态卷、独立的输出位置和口令文件挂载到一次性 CLI 容器中运行相同命令。输出位置必须位于 `/home/node/.xopc` 之外，否则 `create` 会拒绝；容器删除后也不能丢失备份。参见[使用 Docker 安装](./docker.md)。

需要覆盖外部工作区或特殊扩展时，按[数据和文件位置](./workspace.md)中的清单手动备份，并在隔离机器上测试恢复。
