# xopc 工作站 · 产品设计系统 (Design System)

> **版本**: v1.0 · **建立时间**: 2026-03
> 本文档是 xopc 所有产品的设计宪法，所有 UI 决策应以此为准。

---

## 0. 品牌哲学 (Brand Philosophy)

### 产品定位
xopc 工作站是为**超级个体**打造的 AI 增强认知工作台。它不是一个工具，而是一个**个人操作系统** — 让一个人拥有团队的战斗力，通过知识管理、轻项目组织和 AI 催化，持续放大个人能力，形成基于自身数据的飞轮效应。

### 设计哲学：Calm Intelligence（沉静智能）
> *"界面本身是安静的，智能隐藏在背后。当你需要它时，它精准出现；当你不需要它时，它完全消失。"*

界面永远是背景，用户的思想才是主角。我们拒绝一切不必要的视觉噪音。

### 三大核心价值观
- **优雅 (Elegant)**: 每一个像素都有存在的理由。比例、留白、层级，构成无声的美感。不是装饰，而是结构本身的美。
- **智能 (Intelligent)**: AI 能力自然融入工作流，不突兀，不打断。像一个安静、精准的助手，在你需要时出现。
- **克制 (Restrained)**: 少即是多。色彩克制，动效克制，信息克制。每次只做一件事，做到极致。

### 设计反模式（我们坚决避免的）
- ❌ 过度使用彩色，让界面变成"彩虹"
- ❌ 动效炫技，打断用户的思维流
- ❌ 信息过载，同时展示太多内容
- ❌ 强迫用户学习复杂的操作逻辑
- ❌ 用装饰性元素填充留白

---

## 2. 色彩规范 (Color Palette)

### 色彩哲学
xopc 的色彩体系遵循**"灰色是主角，蓝色是信号"**的原则。界面 95% 的面积由灰度色阶构成，蓝色仅在需要引导用户注意力的关键时刻出现。这种克制让蓝色每次出现都具有意义，不被稀释。

双模式设计原则：
- **Light 模式**：白色为主，灰色托底，通过"亮度差"区分层级，层级越高越亮
- **Dark 模式**：深灰蓝为主，不用纯黑，通过"亮度差"区分层级，层级越高越亮；用边框替代阴影

---

### 2.1 背景与层级色阶 (Backgrounds & Elevation)

通过灰度色阶的微妙变化来表达界面层级，不依赖阴影。

| 层级语义 | Light Token | Light Hex | Dark Token | Dark Hex |
|----------|-------------|-----------|------------|----------|
| 全局底层 App Background | `bg-slate-50` | `#f8fafc` | `dark:bg-slate-950` | `#020617` |
| 主内容区 Content Area | `bg-white` | `#ffffff` | `dark:bg-slate-900` | `#0f172a` |
| 卡片/面板 Card | `bg-white` + `border-slate-100` | `#ffffff` | `dark:bg-slate-900` + `dark:border-slate-800` | `#0f172a` |
| 侧边栏 Sidebar | `bg-slate-50` | `#f8fafc` | `dark:bg-slate-950` | `#020617` |
| 悬浮/激活 Hover | `bg-slate-100` | `#f1f5f9` | `dark:bg-slate-800` | `#1e293b` |
| 次级激活 Active | `bg-slate-200` | `#e2e8f0` | `dark:bg-slate-700` | `#334155` |

> **层级规律**：Light 模式下层级越高越亮（白色 > 浅灰 > 灰）；Dark 模式下层级越高越亮（深灰蓝 > 次深 > 更浅）。

> **应用壳（侧栏 + 主区）**：这一层级的分区靠**背景色阶（区块色）**表达，**不在**侧栏与主内容之间使用整根竖向边框或外框线。细边框仅用于内层组件（卡片、列表、输入框、弹窗等），见 [4.2](#42-应用壳左侧导航与主工作区区块色块与边框边界)。

---

### 2.2 品牌强调色：蓝色点缀 (Accent Blue)

蓝色是 xopc 唯一的彩色，代表"智能"与"行动"。**严格限制使用场景**：主要操作按钮（每页最多 1 个）、选中/激活指示、超链接、AI 功能标识。

| 用途 | Light Token | Light Hex | Dark Token | Dark Hex |
|------|-------------|-----------|------------|----------|
| 主操作按钮 | `bg-blue-600` | `#2563eb` | `dark:bg-blue-500` | `#3b82f6` |
| 按钮悬浮态 | `bg-blue-700` | `#1d4ed8` | `dark:bg-blue-600` | `#2563eb` |
| 选中/激活指示 | `bg-blue-600` | `#2563eb` | `dark:bg-blue-500` | `#3b82f6` |
| 柔和选中背景 | `bg-blue-50` | `#eff6ff` | `dark:bg-blue-900/40` | `rgba(30,58,138,0.4)` |
| 蓝色文字/链接 | `text-blue-600` | `#2563eb` | `dark:text-blue-400` | `#60a5fa` |
| AI 功能标识 | `text-blue-500` | `#3b82f6` | `dark:text-blue-400` | `#60a5fa` |

> ⚠️ **克制原则**：一个页面超过 3 处蓝色即为滥用，必须重新审视。Dark 模式下蓝色整体提亮一档（600→500），保证对比度。

---

### 2.3 文本与中性色阶 (Typography & Neutrals)

文本色阶是界面信息层级的骨架，必须严格遵守。

| 层级 | Light Token | Light Hex | Dark Token | Dark Hex | 用途 |
|------|-------------|-----------|------------|----------|------|
| 主要文本 | `text-slate-900` | `#0f172a` | `dark:text-slate-50` | `#f8fafc` | 标题、核心正文、重要数据 |
| 次要文本 | `text-slate-600` | `#475569` | `dark:text-slate-300` | `#cbd5e1` | 正文说明、描述性文字 |
| 辅助文本 | `text-slate-500` | `#64748b` | `dark:text-slate-400` | `#94a3b8` | 时间戳、元信息、占位符 |
| 弱化文本 | `text-slate-400` | `#94a3b8` | `dark:text-slate-500` | `#64748b` | 禁用状态、提示文字 |
| 极弱文本 | `text-slate-300` | `#cbd5e1` | `dark:text-slate-600` | `#475569` | 分割线文字、水印 |

**边框色阶：**

| 层级 | Light Token | Light Hex | Dark Token | Dark Hex | 用途 |
|------|-------------|-----------|------------|----------|------|
| 细边框 | `border-slate-100` | `#f1f5f9` | `dark:border-slate-800` | `#1e293b` | 列表项分割、内部细节 |
| 主边框 | `border-slate-200` | `#e2e8f0` | `dark:border-slate-700` | `#334155` | 卡片、输入框、分割线 |
| 强调边框 | `border-slate-300` | `#cbd5e1` | `dark:border-slate-600` | `#475569` | 需要明确区分的容器 |

> **Dark 模式边框策略**：Dark 模式下丢弃弥散阴影，改用边框勾勒层级（Rim Light 效果）。弹窗、浮层统一用 `dark:border-slate-700` 描边替代阴影。

---

### 2.4 语义色彩 (Semantic Colors)

语义色彩仅用于传达状态，不用于装饰。Light 模式用"浅色背景 + 深色文字"，Dark 模式用"极暗透明背景 + 提亮文字"。

| 状态 | Light 文字 | Light 背景 | Dark 文字 | Dark 背景 | 使用场景 |
|------|-----------|-----------|----------|----------|----------|
| 成功 | `text-emerald-700` | `bg-emerald-50` | `dark:text-emerald-400` | `dark:bg-emerald-950/50` | 操作完成、同步成功 |
| 错误 | `text-red-600` | `bg-red-50` | `dark:text-red-400` | `dark:bg-red-950/50` | 操作失败、必填未填 |
| 警告 | `text-amber-700` | `bg-amber-50` | `dark:text-amber-400` | `dark:bg-amber-950/50` | 注意提示、即将过期 |
| 信息 | `text-blue-600` | `bg-blue-50` | `dark:text-blue-400` | `dark:bg-blue-950/50` | 中性提示、AI 建议 |

---

### 2.5 完整 CSS Variables 参考（推荐实现方式）

将所有色彩 token 定义为 CSS 变量，通过 `.dark` 类切换，是最工程化的实现方式：

```css
:root {
  /* 背景层级 */
  --color-bg-base: #f8fafc;        /* slate-50 */
  --color-bg-surface: #ffffff;     /* white */
  --color-bg-hover: #f1f5f9;       /* slate-100 */
  --color-bg-active: #e2e8f0;      /* slate-200 */

  /* 文本层级 */
  --color-text-primary: #0f172a;   /* slate-900 */
  --color-text-secondary: #475569; /* slate-600 */
  --color-text-tertiary: #64748b;  /* slate-500 */
  --color-text-disabled: #94a3b8;  /* slate-400 */

  /* 边框 */
  --color-border-subtle: #f1f5f9;  /* slate-100 */
  --color-border-default: #e2e8f0; /* slate-200 */
  --color-border-strong: #cbd5e1;  /* slate-300 */

  /* 品牌蓝 */
  --color-accent: #2563eb;         /* blue-600 */
  --color-accent-hover: #1d4ed8;   /* blue-700 */
  --color-accent-soft: #eff6ff;    /* blue-50 */
  --color-accent-text: #2563eb;    /* blue-600 */
}

.dark {
  /* 背景层级 */
  --color-bg-base: #020617;        /* slate-950 */
  --color-bg-surface: #0f172a;     /* slate-900 */
  --color-bg-hover: #1e293b;       /* slate-800 */
  --color-bg-active: #334155;      /* slate-700 */

  /* 文本层级 */
  --color-text-primary: #f8fafc;   /* slate-50 */
  --color-text-secondary: #cbd5e1; /* slate-300 */
  --color-text-tertiary: #94a3b8;  /* slate-400 */
  --color-text-disabled: #64748b;  /* slate-500 */

  /* 边框 */
  --color-border-subtle: #1e293b;  /* slate-800 */
  --color-border-default: #334155; /* slate-700 */
  --color-border-strong: #475569;  /* slate-600 */

  /* 品牌蓝（Dark 模式提亮一档） */
  --color-accent: #3b82f6;         /* blue-500 */
  --color-accent-hover: #2563eb;   /* blue-600 */
  --color-accent-soft: rgba(30,58,138,0.4); /* blue-900/40 */
  --color-accent-text: #60a5fa;    /* blue-400 */
}
```

## 3. 排版规范 (Typography)

### 排版哲学
xopc 是知识工作者长时间使用的工具，排版必须服务于**长时间阅读的舒适性**和**信息的快速扫描**。选择 **Inter** 作为首选 UI 字体，它是目前最接近 Google Sans 气质的开源字体，在屏幕上渲染极为清晰，是 Linear、Vercel、Raycast 的共同选择。
### 3.1 字体家族 (Font Family)

xopc 使用**系统原生字体栈**，无需加载任何外部字体文件，保证最快的渲染速度和最佳的跨平台原生感。在 macOS 上呈现 San Francisco，在 Windows 上呈现 Segoe UI，在 Android/Linux 上呈现 Roboto，在中文环境下自动回退到 PingFang SC / 微软雅黑，始终使用用户设备上最好看的字体。

```css
/* 全局字体定义 */
font-family: -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue",
             "PingFang SC", "Noto Sans", "Noto Sans CJK SC",
             "Microsoft YaHei", 微软雅黑, sans-serif;
```

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system', 'system-ui', '"Segoe UI"', 'Roboto', '"Helvetica Neue"',
          '"PingFang SC"', '"Noto Sans"', '"Noto Sans CJK SC"',
          '"Microsoft YaHei"', '微软雅黑', 'sans-serif'
        ],
      },
    },
  },
}
```

| 字体 | Token | 用途 |
|------|-------|------|
| **系统原生字体栈** | `font-sans` | 所有 UI 文字、正文、标题（默认） |
| **JetBrains Mono** | `font-mono` | 代码片段、数字序列、知识库 ID、文件路径 |

> **中文优先级说明**：`PingFang SC`（苹方）优先于 `Noto Sans CJK SC`，确保 macOS/iOS 上中文字体最优；`Microsoft YaHei`（微软雅黑）作为 Windows 中文兜底，覆盖全平台。
| 字体 | Token | 用途 |
|------|-------|------|
| **Inter** | `font-sans` | 所有 UI 文字、正文、标题（默认） |
| **JetBrains Mono** | `font-mono` | 代码片段、数字序列、知识库 ID、文件路径 |

### 3.2 字号层级 (Type Scale)
严格的 6 级层级，每级都有明确的使用场景，不允许随意使用中间值。

| 层级 | Token | 大小/行高 | 字重 | 使用场景 |
|------|-------|-----------|------|----------|
| Display | `text-3xl tracking-tight` | 30px / 36px | `font-semibold` | 欢迎页、空状态大标题 |
| Title | `text-xl tracking-tight` | 20px / 28px | `font-semibold` | 页面主标题、模态框标题 |
| Heading | `text-base` | 16px / 24px | `font-semibold` | 卡片标题、区块标题 |
| Body | `text-sm leading-relaxed` | 14px / 22px | `font-normal` | 正文内容、知识库文章 |
| UI | `text-sm leading-6` | 14px / 24px | `font-medium` | 按钮、输入框、列表项（最常用） |
| Caption | `text-xs leading-5` | 12px / 20px | `font-normal` | 时间戳、标签、元信息 |

### 3.3 字重使用规范 (Font Weight)
- `font-normal` (400) — 正文、说明文字
- `font-medium` (500) — UI 操作文字、次级标题、强调词
- `font-semibold` (600) — 页面标题、重要数据、主要标题
- **禁止使用** `font-bold` (700) 及以上 — 过于厚重，破坏优雅感

### 3.4 字间距 (Letter Spacing)
- 大标题必须加 `tracking-tight`（-0.025em），避免标题字母间距过松显得廉价
- 正文和 UI 文字使用默认字间距，不额外调整
- 全大写文字（如标签、状态文字）加 `tracking-wide`（0.025em）

---

## 4. 间距与布局 (Spacing & Layout)
基于 **8pt 网格系统 (8-Point Grid)**，保证视觉律动感和开发的一致性。

- **组件内微间距 (Micro)**: `4px (p-1)` 或 `8px (p-2)` — 图标与相邻文字之间
- **常规间距 (Normal)**: `16px (p-4)` 或 `24px (p-6)` — 卡片内边距、表单上下间距
- **区块间距 (Section)**: `32px (p-8)` 或 `48px (p-12)` — 页面中不同模块的逻辑隔离

### 4.1 xopc 双密度布局模式

xopc 工作站有两种核心使用场景，对应两种布局密度，通过用户设置切换：

**聚焦模式 (Focus Mode)** — 用于写作、深度思考、知识整理
- 单列居中布局，内容区最大宽度 `max-w-2xl`（672px）
- 大量留白，上下 padding `py-16`
- 隐藏侧边栏，隐藏所有非必要 UI 元素
- 字号升至 `text-base leading-loose`，行高更宽松
- 参考：iA Writer、Bear、Apple Notes

**工作台模式 (Workbench Mode)** — 用于项目管理、知识库浏览、多任务处理
- 三栏布局：侧边导航（240px）+ 列表区（320px）+ 内容区（剩余）
- 紧凑间距，`p-4` 为基础单位
- 信息密度更高，展示更多元数据
- 参考：Linear、Notion、Raycast

### 4.2 应用壳：左侧导航与主工作区（区块色块与边框边界）

Gateway 控制台等工作台界面采用 **左侧导航 + 右侧主内容** 结构。这一 **整体大布局** 的层级与分区应通过 **背景色阶（区块色）** 呈现：侧栏与主区使用相邻一档的表面色 / 基底色，形成柔和明度差即可。

- **左侧导航**：使用较「底」的一层（如 `bg-slate-50` / `dark:bg-slate-950`），与全局底或主区形成区块感。
- **右侧主内容区**：使用较「浮」的一层（如 `bg-white` / `dark:bg-slate-900`），作为阅读与操作的主表面。
- **不要做**：在侧栏与主内容之间加 **整根竖向 border** 或把整个壳包进 **粗外框**，用线去切「大块」区域。
- **仍要做**：列表行、卡片、表格单元、输入框、模态与抽屉等 **内层组件** 可以继续使用细边框、分割线（见 2.3、5.2、10.2），用于局部编组与可读性。

**一句话**：**大布局靠色块、无声；小组件可以用线。**

---

## 5. 形状与阴影 (Shapes & Elevation)

### 5.1 有机感圆角 (Border Radius)
圆角是传递"亲切感"的核心元素。xopc 选择有机感（圆润）风格，圆角比例偏大。

| 元素类型 | Token | 大小 | 说明 |
|----------|-------|------|------|
| 卡片、弹窗、大容器 | `rounded-2xl` | 16px | 主要容器，有机感的核心 |
| 按钮、输入框 | `rounded-xl` | 12px | 交互组件，亲切但不失专业 |
| **分段控件**（顶栏语言 / 主题、列表网格切换等） | 轨道 `rounded-full` + 滑块 `rounded-full` | CSS `--radius-pill` → `rounded-pill` | 灰色轨道 (`bg-surface-hover`)、浅色浮起滑块 (`bg-surface-panel` + 轻阴影)，与参考图一致的大圆角「胶囊」语义，不是直角分段 |
| 小型标签、Badge | `rounded-lg` | 8px | 微小元素 |
| 头像、图标容器 | `rounded-full` | 50% | 完全圆形，用于人物和品牌标识 |

**分段控件实现约定（Gateway / Web）**：轨道与每项使用同一套 class，避免顶栏各开关风格漂移。共享常量见 `web/src/components/ui/segmented-styles.ts`（`segmentedTrackClassName`、`segmentedThumbBaseClassName`、`segmentedThumbActiveClassName`）。选中项需要强调色时在外层追加 `text-accent-fg`（如主题、图标型分段）。

> **有机感原则**：圆角应该让人感觉"柔软"，而不是"锋利"。当你不确定用多大圆角时，选更大的那个。

### 5.2 阴影策略 (Shadows)
克制使用阴影。通过大面积、低透明度的弥散阴影区分层级，不用深色硬阴影。

- **应用壳（侧栏 / 主区）**: 不靠阴影也不靠大块边框分割，靠背景色阶（见 [4.2](#42-应用壳左侧导航与主工作区区块色块与边框边界)）。
- **主区内的默认卡片**: 无阴影，主要靠 `border border-slate-100` 与灰色背景区分（指内容区内的卡片，不是壳层分区）。
- **悬浮/弹出层**: `shadow-lg shadow-slate-200/60` — 柔和弥散投影
- **模态弹窗**: `shadow-2xl shadow-slate-900/10` — 更深的高层级投影，强化视觉焦点

---

## 6. 图标系统 (Iconography)

### 6.1 图标库选择
**首选：[Lucide Icons](https://lucide.dev/)**

选择理由：
- **Outline 风格**：线条图标与 xopc 的克制、优雅气质完美匹配，不像 Filled 图标那样视觉重量过大
- **一致性**：所有图标使用相同的笔画宽度（1.5px stroke），视觉高度统一
- **完整性**：覆盖知识管理、项目管理、AI 工具所需的全部图标场景
- **React 友好**：`lucide-react` 包支持按需引入，不增加包体积

```bash
npm install lucide-react
```

### 6.2 图标使用规范

| 场景 | 尺寸 | Token |
|------|------|-------|
| 导航菜单图标 | 20px | `size={20}` |
| 按钮内图标 | 16px | `size={16}` |
| 列表项图标 | 16px | `size={16}` |
| 空状态插图图标 | 48px | `size={48}` |
| 页面级大图标 | 32px | `size={32}` |

### 6.3 图标色彩规范
- **导航/功能图标**：`text-slate-500`，激活时 `text-slate-900`
- **操作按钮内图标**：继承按钮文字颜色
- **状态图标**：使用对应语义色（成功用 emerald，错误用 red）
- **AI 功能图标**：`text-blue-500`，与 AI 功能标识保持一致
- **禁止**：给图标单独加彩色，除非是语义状态图标

---

## 7. 组件状态规范 (Component States)

所有交互组件必须实现完整的 6 态状态机，缺少任何一态都是不完整的实现。

### 7.1 六态状态机

| 状态 | 描述 | 视觉表现 |
|------|------|----------|
| **Default** | 默认静止态 | 正常样式，无特殊处理 |
| **Hover** | 鼠标悬浮 | `bg-slate-100`，`transition-colors duration-150` |
| **Active / Pressed** | 点击按下 | `scale-95`，模拟按压手感 |
| **Focus** | 键盘聚焦 | `ring-2 ring-blue-500 ring-offset-2`，永远不能去掉 |
| **Disabled** | 禁用态 | `opacity-50 cursor-not-allowed`，不响应任何交互 |
| **Loading** | 加载中 | 替换内容为 spinner 或骨架屏，保持组件尺寸不变 |

### 7.2 按钮变体规范

**主要按钮 (Primary)** — 每页最多 1 个，代表最重要的操作
```
bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-medium
hover:bg-blue-700 active:scale-95 transition-all duration-150
focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
disabled:opacity-50 disabled:cursor-not-allowed
```

**次要按钮 (Secondary)** — 辅助操作
```
bg-white text-slate-700 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium
hover:bg-slate-50 active:scale-95 transition-all duration-150
```

**幽灵按钮 (Ghost)** — 最低视觉权重，用于工具栏、列表操作
```
text-slate-600 rounded-xl px-3 py-1.5 text-sm font-medium
hover:bg-slate-100 active:scale-95 transition-all duration-150
```

**危险按钮 (Destructive)** — 删除、清空等不可逆操作
```
bg-red-600 text-white rounded-xl px-4 py-2 text-sm font-medium
hover:bg-red-700 active:scale-95 transition-all duration-150
```

### 7.3 输入框规范

```
bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900
placeholder:text-slate-400
hover:border-slate-300
focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500
disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed
```

---

## 8. 动效与交互 (Motion & Interaction)

### 8.1 动效哲学
动效是为了**传达信息**，不是为了炫技。每一个动效都应该回答："这个动效让用户更清楚发生了什么吗？"如果答案是否定的，去掉它。

### 8.2 动效规范

| 场景 | Token | 时长 | 说明 |
|------|-------|------|------|
| 颜色/背景切换 | `transition-colors duration-150 ease-out` | 150ms | 悬浮、激活态切换 |
| 尺寸/位移变化 | `transition-all duration-200 ease-out` | 200ms | 展开/收起、位移 |
| 弹窗/面板出现 | `transition-all duration-300 ease-out` | 300ms | 模态框、抽屉 |
| 按压反馈 | `active:scale-95` | 即时 | 所有按钮和可点击卡片必须有 |
| 微上浮 | `hover:-translate-y-0.5` | 配合 200ms | 卡片悬浮时的轻微上浮 |

### 8.3 无障碍焦点 (Focus State)
永远不要去掉键盘焦点轮廓。使用统一规范：
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
```

---

## 9. 空状态与加载态 (Empty & Loading States)

空状态和加载态是产品"亲切感"最关键的时刻。用户在这里最脆弱，设计必须给予安慰和引导。

### 9.1 空状态设计规范

空状态必须包含三个要素：**图标 + 标题 + 行动引导**，缺一不可。

```
结构：
[48px Lucide 图标，text-slate-300]
[标题，text-slate-900 text-lg font-semibold，mt-4]
[说明文字，text-slate-500 text-sm，mt-2，max-w-xs text-center]
[主要操作按钮，mt-6]（可选，但强烈推荐）
```

**各模块空状态文案示例：**
- **知识库为空**：图标 `BookOpen`，标题"开始构建你的知识库"，说明"把你读过的文章、想法、笔记都放在这里，让 AI 帮你连接它们。"
- **项目为空**：图标 `Layers`，标题"创建你的第一个项目"，说明"用轻项目组织你的想法和行动，一个项目就是一个推进中的故事。"
- **搜索无结果**：图标 `Search`，标题"没有找到相关内容"，说明"试试换个关键词，或者让 AI 帮你搜索。"

### 9.2 加载态规范

**骨架屏 (Skeleton)** — 用于列表、卡片等有固定结构的内容
- 使用 `bg-slate-200 animate-pulse rounded-lg` 模拟内容形状
- 骨架屏的形状必须与真实内容的布局一致，不能随意画矩形
- 颜色：`bg-slate-200`（亮色模式），`bg-slate-700`（暗色模式）

**行内 Spinner** — 用于按钮点击后的等待、局部数据刷新
- 使用 Lucide 的 `Loader2` 图标配合 `animate-spin`
- 大小与按钮内图标一致（16px）
- 按钮加载时：禁用按钮 + 替换文字为 spinner + 保持按钮宽度不变（避免布局抖动）

**全屏加载** — 仅用于应用初始化，不用于页面切换
- 居中显示品牌 Logo + 细线进度条
- 超过 3 秒必须显示"加载较慢，请检查网络"的友好提示

---

## 10. 暗色模式体系 (Dark Mode)
遵循"深邃但不死黑"的原则。不使用纯黑 (`#000`)，而是基于深灰蓝 (`slate-900/950`) 打造具有呼吸感和层次感的暗夜映射。

### 10.1 背景与层级映射 (Dark Backgrounds)
在暗色模式下，层级越高的元素（离用户越近的元素），背景色应该越亮。

- **全局背景**: `dark:bg-slate-950` — 极深的午夜蓝灰，作为无穷远的基底
- **卡片/容器**: `dark:bg-slate-900` — 对比出微弱的悬浮感
- **悬浮/激活态**: `dark:bg-slate-800`
- **侧边栏**: `dark:bg-slate-950` — 与主内容区用 **相邻背景色阶** 区分（与 [4.2](#42-应用壳左侧导航与主工作区区块色块与边框边界) 一致），**不依赖**侧栏与主区之间的竖向大边框

### 10.2 文本与边框翻转 (Dark Typography & Borders)
- **主要文本**: `dark:text-slate-50` — 接近纯白，但在暗色背景下不刺眼
- **次要文本**: `dark:text-slate-400`
- **辅助文本**: `dark:text-slate-500`
- **弱化文本**: `dark:text-slate-600`
- **边框**: `dark:border-slate-800` — 用于 **内层** 列表、卡片、输入框等；**应用壳** 层级仍以背景色阶为主，边框为辅（见 [4.2](#42-应用壳左侧导航与主工作区区块色块与边框边界)）

### 10.3 色彩适应 (Color Adaptation)
暗色模式下的彩色需要稍微"提亮"以保证对比度。

- **主色**: `dark:bg-blue-500` — 比亮色模式的 blue-600 更亮，保证可见性
- **柔和主色**: `dark:bg-blue-900/40` 配合 `dark:text-blue-400`
- **语义色彩**: 均调整为高亮文字 + 极暗透明背景。例如成功：`dark:text-emerald-400 dark:bg-emerald-950/50`

### 10.4 阴影策略 (Dark Shadows)
- **丢弃弥散阴影**：在 `bg-slate-950` 上，传统阴影会显得浑浊
- **发光描边替代**：弹窗和浮层采用 `dark:shadow-none dark:border dark:border-slate-700 dark:bg-slate-900` 的组合，利用微弱的亮色边框勾勒轮廓（Rim Light 效果）

---

## 11. 品牌声音 (Brand Voice)

### 11.1 品牌个性
xopc 的声音是一个**聪明、安静、可信赖的伙伴**。它不是一个助手，而是一个和你一起工作的搭档。它说话简洁、精准、有温度，但从不啰嗦，从不卖弄。

### 11.2 文案四原则

**简洁**：能用 5 个字说清楚的，不用 10 个字。
- ✅ "已保存" 而不是 "您的内容已经成功保存到本地"
- ✅ "开始" 而不是 "点击开始使用"

**精准**：告诉用户发生了什么，不要模糊。
- ✅ "同步失败，请检查网络连接" 而不是 "出现了一些问题"
- ✅ "删除后无法恢复" 而不是 "确定要继续吗？"

**有温度**：在关键时刻给予鼓励，但不过度。
- ✅ "今天完成了 3 个任务，不错。" 而不是 "🎉🎉🎉 太棒了！你真是太厉害了！！！"
- ✅ "这里还没有内容，先添加一个吧。" 而不是 "暂无数据"

**尊重用户**：不要假设用户不懂，不要过度解释。
- ✅ "导入" 而不是 "点击这里把你的文件导入进来"
- ✅ 错误信息给出具体原因，而不是 "未知错误"

### 11.3 AI 功能的文案规范
AI 功能是 xopc 的核心差异化，文案必须传达"智能但不神秘"的感觉。

- AI 正在思考：**"正在分析..."** 而不是 "AI 正在努力为您处理中..."
- AI 给出建议：**"基于你的笔记，这里有一些关联"** 而不是 "AI 为您智能推荐了以下内容"
- AI 操作完成：**"完成"** 或 **"已整理"** — 简洁，不强调是 AI 做的
- 引导使用 AI：**"让 AI 帮你深入研究这个话题"** — 自然，像朋友的建议

### 11.4 数字与单位
- 时间：使用相对时间，"3 分钟前"、"昨天"、"上周"，而不是绝对时间戳
- 数量：超过 999 用 "1k"、"2.3k"，保持简洁
- 进度：用百分比或分数，"3/10 完成" 比 "30%" 更有成就感

---

## 12. Logo 与品牌标识 (Logo & Brand Identity)

### 12.1 Logo 设计原则
基于**有机感**风格，Logo 应具备以下特征：
- **圆润**：主要形状使用圆角或圆形，避免尖锐的直角
- **简洁**：单色可识别，在 16px 的 favicon 尺寸下依然清晰
- **有记忆点**：与"工作站"、"个人操作系统"的概念有视觉关联
- **可延展**：能在深色/浅色背景上都表现良好

### 12.2 品牌色在 Logo 中的应用
- **主版本**：深色 Logo（`slate-900`）用于浅色背景
- **反色版本**：白色 Logo 用于深色背景和品牌色背景
- **品牌色版本**：`blue-600` 底色 + 白色 Logo，用于启动屏、营销场景
- **禁止**：在 Logo 上使用渐变色，保持克制的单色原则

### 12.3 安全区域 (Clear Space)
Logo 周围必须保留等于 Logo 高度 1/4 的安全空白区域，任何其他元素不得侵入。


---

## 13. 多端设计规范 (Multi-Platform Design)

xopc 工作站优先覆盖三个端：**Web（浏览器）**、**PC 客户端（Electron/桌面）**、**Phone（移动端）**。三端共享同一套设计语言（色彩、字体、圆角、动效），但在布局密度、交互方式、导航结构上有明确的差异化规范。

### 13.0 三端定位与优先级

| 端 | 定位 | 核心场景 | 迭代优先级 |
|----|------|----------|------------|
| **Web** | 主力工作台，功能最完整 | 知识库管理、项目推进、AI 研究 | P0 首发 |
| **PC 客户端** | 深度工作场景，系统级集成 | 长时间专注写作、本地文件联动、快捷键驱动 | P1 |
| **Phone** | 随时捕捉，轻量查阅 | 快速记录 Idea、查看进度、碎片时间消费 | P2 |

> **设计原则**：Phone 端不是 Web 端的缩小版，而是专为"捕捉与消费"设计的独立体验。PC 端不是 Web 端的复制，而是深度集成系统能力的增强版。

---

### 13.1 Web 端规范

**目标用户行为**：坐在桌前，有明确的工作目标，使用鼠标 + 键盘，可能同时开多个标签页。

#### 断点系统 (Breakpoints)

| 断点名 | 宽度范围 | 典型设备 | 布局策略 |
|--------|----------|----------|----------|
| `sm` | < 768px | 小屏平板、竖屏 | 单列，隐藏侧边栏 |
| `md` | 768px – 1024px | iPad 横屏、小笔记本 | 双列，侧边栏可折叠 |
| `lg` | 1024px – 1440px | 主流笔记本 | 三列标准布局 |
| `xl` | > 1440px | 大屏显示器 | 三列 + 内容区加宽，最大 `max-w-screen-xl` |

#### 布局结构

```
┌─────────────────────────────────────────────────────┐
│  顶部导航栏 (TopBar) — 高度 48px，仅 sm 断点显示    │
├──────────┬──────────────────────┬───────────────────┤
│ 侧边导航  │    列表/内容区        │   详情/编辑区      │
│ 240px    │    320px             │   剩余宽度         │
│ (固定)   │    (可调整)           │   (主工作区)       │
└──────────┴──────────────────────┴───────────────────┘
```

（示意图中的竖线仅为排版对齐，**不代表**要在侧栏与主区之间画实线边框；实际靠 **背景色块** 区分，见 [4.2](#42-应用壳左侧导航与主工作区区块色块与边框边界)。）

- **侧边导航**：固定宽度 240px，包含模块导航 + 用户信息，不可横向拖拽；与右侧主区 **用背景色阶区分**，不用整栏竖向 border。
- **列表区**：最小 280px，最大 400px，可通过拖拽分割线调整
- **主工作区**：剩余宽度，内容最大宽度 `max-w-3xl`（聚焦模式）或无限制（工作台模式）
- **响应式策略**：`md` 断点以下侧边栏收起为图标栏（宽度 56px），`sm` 断点以下完全隐藏为底部 Tab

#### Web 端特有规范
- **键盘快捷键**：所有核心操作必须有快捷键，并在 Tooltip 中显示（如 `⌘K` 打开命令面板）
- **悬浮 Tooltip**：所有图标按钮必须有 Tooltip，延迟 400ms 显示，避免打扰快速操作
- **右键菜单**：列表项、卡片支持右键上下文菜单，提供快捷操作
- **拖拽排序**：项目列表、知识库条目支持拖拽排序，拖拽时显示占位线

---

### 13.2 PC 客户端规范（Electron / 桌面）

**目标用户行为**：深度工作模式，长时间专注，期望系统级集成（通知、文件系统、全局快捷键）。

#### 与 Web 端的差异

| 维度 | Web 端 | PC 客户端 |
|------|--------|-----------|
| 标题栏 | 浏览器原生 | 自定义无边框标题栏，集成窗口控制按钮 |
| 快捷键 | `⌘/Ctrl` 系列 | 支持全局快捷键（应用未聚焦时也可触发） |
| 文件访问 | 受浏览器沙箱限制 | 直接读写本地文件系统 |
| 通知 | Web Notification | 系统原生通知 |
| 窗口管理 | 浏览器标签 | 多窗口、分屏支持 |

#### 标题栏设计

```
┌─────────────────────────────────────────────────────┐
│ ● ● ●  [xopc]  当前页面标题          [搜索] [设置]  │  高度: 40px (macOS) / 32px (Windows)
└─────────────────────────────────────────────────────┘
```

- **macOS**：红绿灯按钮保留在左侧，标题栏可拖拽移动窗口，`-webkit-app-region: drag`
- **Windows**：最小化/最大化/关闭按钮在右侧，使用自定义样式与品牌色保持一致
- **标题栏高度**：macOS 40px，Windows 32px，内容区相应调整

#### PC 端特有规范
- **聚焦模式快捷键**：`⌘/Ctrl + Shift + F` 进入全屏聚焦写作模式，隐藏所有 UI
- **全局命令面板**：`⌘/Ctrl + K` 随时唤起，支持模糊搜索所有功能和内容
- **最小窗口尺寸**：宽 900px × 高 600px，低于此尺寸显示提示
- **系统托盘**：支持最小化到系统托盘，后台运行 AI 任务

---

### 13.3 Phone 端规范（iOS / Android）

**目标用户行为**：碎片时间，单手操作，快速捕捉想法，查看进度，不做复杂编辑。

#### 核心设计原则
- **拇指友好区**：所有主要操作按钮必须在屏幕下半部分（拇指自然触达区）
- **单列布局**：Phone 端只有单列，无侧边栏，通过底部 Tab 切换模块
- **最小点击区域**：所有可点击元素最小 44×44pt（iOS HIG 标准），避免误触
- **快速捕捉优先**：首屏必须有一键添加 Idea 的入口，3 秒内完成记录

#### 屏幕尺寸适配

| 设备类型 | 逻辑分辨率 | 适配策略 |
|----------|------------|----------|
| 小屏 iPhone (SE) | 375×667pt | 基准尺寸，所有设计以此为准 |
| 标准 iPhone | 390×844pt | 内容区自然延伸 |
| 大屏 iPhone Pro Max | 430×932pt | 底部安全区加高，内容区加宽 |
| Android 标准 | 360×800dp | 与 iPhone 标准接近，兼容处理 |

#### 导航结构

```
┌─────────────────────────┐
│  状态栏 (系统)           │
├─────────────────────────┤
│  页面标题 + 右上角操作   │  高度: 44pt (iOS) / 56dp (Android)
├─────────────────────────┤
│                         │
│                         │
│      主内容区            │
│                         │
│                         │
├─────────────────────────┤
│  底部 Tab 导航           │  高度: 49pt + 安全区
│  知识库 | 项目 | 捕捉 | 我 │
└─────────────────────────┘
```

- **底部 Tab**：4 个核心模块，中间"捕捉"按钮突出显示（稍大，蓝色强调）
- **页面标题栏**：左侧返回按钮，中间标题，右侧最多 2 个操作图标
- **手势支持**：左滑返回（iOS 原生），下拉刷新，长按触发上下文菜单

#### Phone 端特有组件规范

**快速捕捉浮层 (Quick Capture)**
- 点击底部 Tab 中间的"捕捉"按钮，从底部弹出半屏输入浮层
- 输入框自动聚焦，键盘弹起，浮层随键盘上移
- 支持：纯文字 / 语音转文字 / 拍照附件
- 发送后自动收起，不打断当前页面

**列表项高度**
- Phone 端列表项最小高度 56pt（比 Web 端的 40px 更高），便于点击
- 左滑显示操作按钮（删除、归档），右滑标记完成

**字号适配**
- Phone 端字号整体比 Web 端大 1 档：Web 的 `text-sm`(14px) 对应 Phone 的 `text-base`(16px)
- 最小可读字号：12pt（`text-xs`），低于此字号不允许出现正文内容

---

### 13.4 三端共享规范

以下规范在三端完全一致，不允许因为端的不同而有差异：

| 规范项 | 统一标准 |
|--------|----------|
| **色彩系统** | 完全共享第 2 章的色彩规范，Light/Dark 双模式 |
| **字体家族** | 完全共享第 3 章的系统字体栈 |
| **圆角风格** | 有机感大圆角，Web/PC 用 `rounded-2xl`，Phone 用 `rounded-2xl`（保持一致） |
| **语义色彩** | 成功/错误/警告/信息的颜色完全一致 |
| **品牌声音** | 文案风格、AI 功能表述完全一致 |
| **图标库** | 统一使用 Lucide Icons，风格一致 |
| **动效时长** | 颜色切换 150ms，位移 200ms，弹窗 300ms（三端一致） |

---

### 13.5 三端设计交付规范

在设计和开发协作时，每个功能需要交付以下内容：

| 交付物 | Web | PC | Phone |
|--------|-----|----|-------|
| Light 模式设计稿 | ✅ 必须 | ✅ 必须 | ✅ 必须 |
| Dark 模式设计稿 | ✅ 必须 | ✅ 必须 | ✅ 必须 |
| 空状态设计 | ✅ 必须 | ✅ 必须 | ✅ 必须 |
| 加载态设计 | ✅ 必须 | ✅ 必须 | ✅ 必须 |
| 错误态设计 | ✅ 必须 | ✅ 必须 | ✅ 必须 |
| 键盘快捷键说明 | ✅ 必须 | ✅ 必须 | ➖ 不适用 |
| 手势交互说明 | ➖ 不适用 | ➖ 不适用 | ✅ 必须 |

