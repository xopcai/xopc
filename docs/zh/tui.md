# 终端界面

终端界面是全屏本地聊天客户端。希望交互使用 xopc，但不打开桌面或浏览器控制台时使用它。

## 启动

```bash
xopc
```

等同于：

```bash
xopc tui
```

它使用当前 xopc Profile、默认 Agent、模型配置和本地 Session 存储。

## 恢复工作

```bash
xopc resume
xopc resume <session-key>
```

不知道 key 时先运行 `xopc session list`。

## 连接 Gateway

Session 和 Agent 位于另一个运行中的 xopc 实例时，使用 Gateway 模式：

```bash
xopc tui --gateway
xopc tui --url <gateway-url>
```

通过支持的提示或参数提供 Gateway Token，不要把它留在共享 Shell 历史中。

## TUI 还是交互式 CLI？

| 模式 | 适合 |
| --- | --- |
| `xopc` / `xopc tui` | 带实时进度的全屏对话 |
| `xopc agent -i` | 简单逐行交互 |
| `xopc agent -m "…"` | Shell 或脚本中的单次请求 |

## 故障排查

- TUI 立即退出：运行 `xopc doctor` 和 `xopc models status`。
- 文字显示异常：使用 UTF-8 终端和支持所需字符的字体。
- Agent 或 Session 错误：检查 `xopc profile list`、`xopc config path` 和 Gateway URL。
- 远程进度断开：验证隧道或网络，并在主机运行 `xopc gateway health`。
