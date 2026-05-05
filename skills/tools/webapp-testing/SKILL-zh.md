---
name: webapp-testing
description: 使用 Playwright 与本地 Web 应用交互和测试的工具包。支持验证前端功能、调试 UI 行为、捕获浏览器截图和查看浏览器日志。
license: 完整条款见 LICENSE.txt
---

# Web 应用测试

要测试本地 Web 应用，编写原生 Python Playwright 脚本。

**可用辅助脚本：**
- `scripts/with_server.py` - 管理服务器生命周期（支持多服务器）

**始终先使用 `--help` 运行脚本** 查看用法。在尝试运行脚本并发现确实需要定制化解决方案之前，不要读取源码。这些脚本可能非常庞大，会污染你的上下文窗口。它们应作为黑盒脚本直接调用，而非被吸收到你的上下文窗口中。

## 决策树：选择你的方法

```
用户任务 → 是否为静态 HTML？
    ├─ 是 → 直接读取 HTML 文件识别选择器
    │         ├─ 成功 → 使用选择器编写 Playwright 脚本
    │         └─ 失败/不完整 → 按动态处理方式（见下方）
    │
    └─ 否（动态 Web 应用）→ 服务器是否已在运行？
        ├─ 否 → 运行：python scripts/with_server.py --help
        │        然后使用辅助工具 + 编写简化的 Playwright 脚本
        │
        └─ 是 → 侦察-然后-行动模式：
            1. 导航并等待 networkidle
            2. 截取屏幕截图或检查 DOM
            3. 根据渲染状态识别选择器
            4. 使用发现的选择器执行操作
```

## 示例：使用 with_server.py

要启动服务器，先运行 `--help`，然后使用辅助工具：

**单服务器：**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**多服务器（如后端 + 前端）：**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

创建自动化脚本时，只包含 Playwright 逻辑（服务器由辅助工具自动管理）：
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True) # 始终以 headless 模式启动 chromium
    page = browser.new_page()
    page.goto('http://localhost:5173') # 服务器已在运行并准备就绪
    page.wait_for_load_state('networkidle') # 关键：等待 JS 执行完毕
    # ... 你的自动化逻辑
    browser.close()
```

## 侦察-然后-行动模式

1. **检查渲染后的 DOM**：
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **根据检查结果识别选择器**

3. **使用发现的选择器执行操作**

## 常见陷阱

❌ **不要**在动态应用上等待 `networkidle` 之前检查 DOM
✅ **要**在检查之前等待 `page.wait_for_load_state('networkidle')`

## 最佳实践

- **将内置脚本作为黑盒使用** - 完成任务时，考虑 `scripts/` 中的某个脚本是否可以帮助。这些脚本能可靠地处理常见、复杂的工作流，而不会占用上下文窗口。使用 `--help` 查看用法，然后直接调用。
- 对同步脚本使用 `sync_playwright()`
- 完成后始终关闭浏览器
- 使用描述性选择器：`text=`、`role=`、CSS 选择器或 ID
- 添加适当的等待：`page.wait_for_selector()` 或 `page.wait_for_timeout()`

## 参考文件

- **examples/** - 展示常见模式的示例：
  - `element_discovery.py` - 发现页面上的按钮、链接和输入框
  - `static_html_automation.py` - 使用 file:// URL 处理本地 HTML
  - `console_logging.py` - 在自动化过程中捕获控制台日志
