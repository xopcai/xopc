---
name: browser
description: 使用 browser_use 进行网页导航、页面检查、UI 交互、截图、网络抓包和可复用浏览器 pipeline。在执行复杂浏览器任务前加载此 skill。
metadata:
  xopc:
    requires_tools:
      - browser_use
---

# 浏览器技能（Browser）

## 概述

`browser_use` 是 XOPC 的统一浏览器工具，支持四种模式：

| 模式 | 用途 |
|------|------|
| `command` | 执行单个浏览器动作 |
| `pipeline` | 执行多步骤 YAML 流程 |
| `inspect` | 获取当前页面状态 |
| `close` | 关闭浏览器 session |

## 何时使用

- 需要打开网页、点击控件、填写表单
- 需要截图或获取页面内容
- 需要执行多步骤自动化流程
- 需要从页面提取数据

## Command 模式

### 基本用法

```json
{
  "mode": "command",
  "command": "<action>",
  "args": { ... }
}
```

### 可用 Command

| Command | 说明 | 关键参数 |
|---------|------|----------|
| `open` / `navigate` | 打开 URL | `url`, `wait_until` |
| `state` / `snapshot` | 获取页面 ARIA snapshot | `selector`, `maxLength` |
| `click` | 点击元素 | `selector` / `text` / `role` |
| `type` / `input` | 输入文本 | `selector` / `label`, `text`, `pressEnter` |
| `scroll` | 滚动页面 | `direction`, `amount` |
| `screenshot` | 截图 | `selector`, `full_page`, `path` |
| `back` | 返回上一页 | `waitFor` |
| `keys` / `press` | 键盘输入 | `key` |
| `console` / `eval` | 执行 JavaScript | `javascript` |
| `images` | 提取页面图片 | `selector`, `maxImages` |
| `wait` | 等待元素或时间 | `selector` / `text` / `ms`, `timeout_ms` |
| `dialog` | 处理弹窗 | `action`（accept/dismiss） |
| `close` | 关闭当前页面 | — |

### 元素定位策略

优先级从高到低：

1. **ARIA role**：最稳定，例如 `"role": "button:Submit"`
2. **可见文本**：例如 `"text": "Sign In"`
3. **CSS 选择器**：例如 `"selector": "#login-btn"`

建议：

- 先用 `inspect` 或 `state` 获取页面 snapshot
- 根据 snapshot 中的 ARIA 信息选择定位方式
- 尽量避免依赖动态生成的 class 名

## Inspect 模式

在执行操作前，先了解当前页面：

```json
{ "mode": "inspect" }
```

返回：当前 URL、页面标题、ARIA snapshot。

**最佳实践**：每次导航后先 inspect，再决定下一步操作。

## Pipeline 模式

适合多步骤、可复用的浏览器流程。使用 brocli 风格的 YAML DSL。

### 通过文件执行

```json
{
  "mode": "pipeline",
  "pipeline": {
    "path": "./browser-flow.yaml",
    "args": { "url": "https://example.com" }
  }
}
```

### 通过内联 YAML 执行

```json
{
  "mode": "pipeline",
  "pipeline": {
    "yaml": "name: quick-check\npipeline:\n  - navigate:\n      url: https://example.com\n  - screenshot:\n      full_page: true",
    "dryRun": false
  }
}
```

### YAML 结构

```yaml
name: pipeline-name
description: 流程说明
args:
  url:
    type: string
    required: true
  query:
    type: string
    default: "hello"
pipeline:
  - navigate:
      url: ${{ args.url }}
      wait_until: domcontentloaded
  - wait:
      selector: input[name="q"]
  - type:
      selector: input[name="q"]
      text: ${{ args.query }}
  - press:
      key: Enter
  - wait:
      selector: body
      timeout_ms: 10000
  - screenshot:
      path: ./artifacts/result.png
      full_page: true
  - output:
      value:
        screenshot: ./artifacts/result.png
on_error:
  - screenshot:
      path: ./artifacts/error.png
      full_page: true
```

### 编写规则

1. 每个步骤只能有一个 action
2. 使用 `${{ args.xxx }}` 引用参数
3. 使用 `${{ data }}` 或 `${{ data | json }}` 引用上一步结果
4. `on_error` 用于失败后采集诊断信息

### 校验模式（不实际执行）

在执行前先校验 YAML 是否合法：

```json
{
  "mode": "pipeline",
  "pipeline": {
    "yaml": "...",
    "dryRun": true
  }
}
```

## 失败恢复

当操作失败时：

1. 使用 `inspect` 获取当前页面状态
2. 确认 URL 是否正确（可能被重定向）
3. 结合 snapshot 判断页面是否加载完成
4. 使用 `screenshot` 做视觉诊断
5. 使用 `wait` 等待元素出现后重试

## 安全注意事项

- URL 中不要包含 API key 或 token
- 不要访问私有 IP / localhost（除非配置明确允许）
- 云元数据地址始终被阻断
- 破坏性操作（如提交表单、删除数据）前应确认用户意图
