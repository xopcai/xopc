---
name: web-artifacts-builder
description: 使用现代前端 Web 技术（React、Tailwind CSS、shadcn/ui）创建精密的、多组件的 claude.ai HTML 制品。用于需要状态管理、路由或 shadcn/ui 组件的复杂制品——不适用于简单的单文件 HTML/JSX 制品。
license: 完整条款见 LICENSE.txt
---

# Web Artifacts Builder（Web 制品构建器）

要构建功能强大的前端 claude.ai 制品，按照以下步骤：
1. 使用 `scripts/init-artifact.sh` 初始化前端仓库
2. 通过编辑生成的代码开发你的制品
3. 使用 `scripts/bundle-artifact.sh` 将所有代码打包到单个 HTML 文件中
4. 向用户展示制品
5. （可选）测试制品

**技术栈**：React 18 + TypeScript + Vite + Parcel（打包）+ Tailwind CSS + shadcn/ui

## 设计与样式指南

非常重要：为避免常说的"AI 同质化"设计，避免过度使用居中布局、紫色渐变、统一圆角和 Inter 字体。

## 快速开始

### 第 1 步：初始化项目

运行初始化脚本创建新的 React 项目：
```bash
bash scripts/init-artifact.sh <project-name>
cd <project-name>
```

这会创建一个完全配置好的项目，包含：
- ✅ React + TypeScript（通过 Vite）
- ✅ Tailwind CSS 3.4.1 及 shadcn/ui 主题系统
- ✅ 配置好的路径别名（`@/`）
- ✅ 预安装了 40+ 个 shadcn/ui 组件
- ✅ 包含所有 Radix UI 依赖
- ✅ Parcel 配置好用于打包（通过 .parcelrc）
- ✅ Node 18+ 兼容性（自动检测并锁定 Vite 版本）

### 第 2 步：开发你的制品

要构建制品，编辑生成的文件。参考下方"常见开发任务"的指导。

### 第 3 步：打包到单个 HTML 文件

要将 React 应用打包为单个 HTML 制品：
```bash
bash scripts/bundle-artifact.sh
```

这会创建 `bundle.html`——一个自包含的制品，包含所有内联的 JavaScript、CSS 和依赖。此文件可直接在 Claude 对话中作为制品分享。

**要求**：你的项目根目录必须有一个 `index.html` 文件。

**脚本作用**：
- 安装打包依赖（parcel、@parcel/config-default、parcel-resolver-tspaths、html-inline）
- 创建带路径别名支持的 `.parcelrc` 配置
- 使用 Parcel 构建（无 source map）
- 使用 html-inline 将所有资源内联到单个 HTML 中

### 第 4 步：与用户分享制品

最后，在对话中与用户分享打包好的 HTML 文件，以便他们作为制品查看。

### 第 5 步：测试/可视化制品（可选）

注意：这是完全可选的步骤。仅在必要或请求时执行。

要测试/可视化制品，使用可用工具（包括其他技能或内置工具如 Playwright 或 Puppeteer）。通常，避免提前测试制品，因为这会在请求和用户看到完成的制品之间增加延迟。在展示制品后，如果请求或出现问题再进行测试。

## 参考

- **shadcn/ui 组件**：https://ui.shadcn.com/docs/components
