# 导出历史到 ctx

XOPC 可以把 Session 导出为由自身维护的 [`ctx-history-jsonl-v2`](https://github.com/ctxrs/ctx/blob/main/docs/custom-history-import-format.md) 数据源。ctx 通过 history-source 插件协议导入这个持久文件，不会直接读取 XOPC 数据库。

## 导出与导入

```bash
xopc history export ctx
ctx import --history-source-manifest ~/.xopc/exports/ctx/ctx-history-plugin.json
```

导出会生成：

- `~/.xopc/exports/ctx/history.jsonl`：持久历史数据源；
- `~/.xopc/exports/ctx/ctx-history-plugin.json`：ctx 插件清单。

首次导入后，可以只搜索 XOPC 历史：

```bash
ctx search "发布决策" --history-source xopc/default
```

XOPC 历史变化后，再次运行 `xopc history export ctx`。导出结果是确定性的；内容没有变化时不会重写文件。ctx 的持久 daemon 注册数据源后，会监视这个文件的后续变化。

可用 `--output-dir <path>` 指定其他目录，或用 `--json` 获取便于脚本处理的结果。

## 导出边界

导出内容包括可见的用户与助手消息、工具调用与输出、本地命令活动以及压缩摘要。隐藏上下文、system prompt、模型 reasoning、不可见扩展消息和已删除 Session 不会导出。每次重置产生的会话 generation 保留各自稳定的 XOPC Session ID。

导出只在用户显式执行命令时发生，XOPC 不会在后台自动运行。支持 POSIX 权限的平台上，新建输出目录和导出文件的权限分别为 `0700` 和 `0600`。如果 Session 可能含有敏感文本，请在导入前检查 JSONL。
