# 更新 xopc


## 查看当前版本

```bash
xopc --version
xopc update --check
```

## 选择发布版本

日常安装使用当前稳定版，服务器与无人值守部署固定具体版本。切换通道或跨版本更新前，查看中间版本的迁移与权限变化。桌面、Gateway、手机和浏览器扩展分别更新。[GitHub Releases](https://github.com/xopcai/xopc/releases) · [npm 版本历史](https://www.npmjs.com/package/@xopcai/xopc) · [移动端下载](./mobile-app.md)

## 桌面应用

应用提供更新时使用 **设置 → Gateway**，或从 [xopc.ai](https://xopc.ai/zh#download) 下载当前安装包。历史安装包仍可在 [GitHub Releases](https://github.com/xopcai/xopc/releases) 查看。替换应用前关闭其它 xopc 窗口。

## 命令行安装

```bash
xopc update
```

通过 npm 全局安装时也可以运行：

```bash
npm install -g @xopcai/xopc@latest
```

## Docker

拉取目标标签并重建容器，保留状态卷：

```bash
docker pull ghcr.io/xopcai/xopc:latest
docker compose up -d
```

需要可预测部署时固定具体版本，不要使用 `latest`。

## 更新后

```bash
xopc --version
xopc config validate
xopc doctor
xopc gateway health
```

然后测试一次模型调用，以及每个重要通道或扩展。查看发布说明中的必填设置、权限变化和迁移注意事项。

## 更新失败时

1. 记录旧版本和尝试安装的版本。
2. 从日志读取第一个更新或启动错误。
3. 确认状态目录可写且磁盘空间充足。
4. 检查扩展兼容性。
5. 不要删除状态目录，其中包含本地数据。

如果更新已经迁移数据库，运行旧版本前先恢复对应的升级前备份。[备份与恢复 xopc](./backup.md)

## 数据库升级

xopc v0.0.487 支持将已安装的 SQLite 数据库从 v202–v280 升级到 v281。全新安装直接使用 v281。

升级前先退出使用同一状态目录的所有 xopc 和 Gateway 进程。xopc 会在数据库旁写入包含已提交 WAL 数据的 `xopc.db.pre-upgrade-v<版本>-<UUID>.bak` 快照，再在一个事务中完成升级和完整性检查。失败会回滚并保留备份。自动快照只包含数据库，配置与外部工作区需要另外备份。[备份与恢复 xopc](./backup.md)

### 恢复 v180 数据库

1. 停止所有相关进程，备份完整状态目录和外部工作区。
2. 使用同一个状态目录启动 [xopc 0.0.332](https://github.com/xopcai/xopc/releases/tag/v0.0.332)，等待它将数据库升级到 v208。Intel Mac 使用 `xopc-0.0.332-x64.dmg`。
3. 完全退出 0.0.332，再启动 v0.0.487 完成数据库升级。核对会话和 Agent 设置后再处理原始备份。
