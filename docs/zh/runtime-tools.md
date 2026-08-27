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
