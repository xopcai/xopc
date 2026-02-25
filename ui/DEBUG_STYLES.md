# UI 样式问题调试指南

## 快速诊断步骤

### 1. 检查 CSS 文件是否正确加载

在浏览器 DevTools (F12) → **Network** 标签：
1. 刷新页面 (Ctrl+R)
2. 查找 `styles.css` 请求
3. 确认状态码是 **200**
4. 点击它查看 Response，确认包含 `@tailwind` 指令

### 2. 检查 Tailwind 是否生效

在 DevTools → **Console** 执行：
```javascript
// 检查 CSS 变量
getComputedStyle(document.documentElement).getPropertyValue('--bg-primary')
// 预期输出: "#fafaf9"

// 检查 Tailwind 类
document.querySelector('.flex')
// 应该返回元素，如果没有则 Tailwind 未生效
```

### 3. 检查 HTML 结构

在 DevTools → **Elements**：
1. 查找 `<body>` 标签
2. 确认有 `class="h-screen"`
3. 检查子元素是否有正确的 Tailwind 类名

### 4. 常见问题和解决方案

#### 问题 A: styles.css 返回 404
**原因**: Vite 没有正确处理 CSS
**解决**:
```bash
cd /home/admin/xopcbot/ui
rm -rf node_modules/.vite
rm -rf dist
npm install
npm run dev
```

#### 问题 B: CSS 加载但无样式
**原因**: Tailwind 未生成类
**解决**: 检查 `tailwind.config.js` 的 content 配置
```javascript
content: [
  "./index.html",
  "./src/**/*.{ts,js}",
]
```

#### 问题 C: Lit 组件样式隔离
**原因**: Lit 组件使用 Shadow DOM，外部 CSS 无法渗透
**解决**: 检查组件是否使用 `createRenderRoot() { return this; }`

### 5. 验证修复

创建一个测试文件验证样式：

```html
<!-- ui/test-styles.html -->
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="./src/styles.css">
</head>
<body class="bg-background text-foreground p-8">
  <h1 class="text-2xl font-bold text-primary">样式测试</h1>
  <div class="mt-4 p-4 bg-secondary rounded-lg shadow-md">
    如果看到背景和文字颜色，样式正常
  </div>
</body>
</html>
```

直接在浏览器打开这个文件测试。

### 6. 完整重置步骤

如果以上都无效：

```bash
# 1. 停止 dev server

# 2. 清理缓存
cd /home/admin/xopcbot/ui
rm -rf node_modules
rm -rf dist
rm -f package-lock.json

# 3. 重新安装
npm install

# 4. 启动
cd /home/admin/xopcbot
npm run dev
```

## 关键检查点

1. **CSS 变量**: 确保 `:root` 变量在 `html` 元素上生效
2. **Tailwind 指令**: `@tailwind base/components/utilities` 必须存在
3. **PostCSS**: 确保 `postcss.config.js` 配置正确
4. **Vite 处理**: 检查 `vite.config.ts` 中 `css.postcss: true`

## 提供反馈

请告诉我以下信息：
1. `styles.css` 是否 200 加载？
2. Console 有什么错误？
3. HTML 元素是否有 Tailwind 类名？
4. 直接访问 `http://localhost:3000/src/styles.css` 能否看到 CSS 内容？
