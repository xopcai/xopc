# 更新 xopc

请使用最初的安装方式更新。进行大版本更新，或已经配置重要 Agent、Workflow、消息通道和扩展时，先备份本地状态。

## 查看当前版本

```bash
xopc --version
xopc update --check
```

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

稳定性选择见[发布通道](./releases.md)，备份见[数据和文件位置](./workspace.md)。
