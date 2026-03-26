# xopc 工作站 · 产品设计系统 (Design System)

> **版本**: v1.2 · **建立时间**: 2026-03 · **修订**: 2026-03-26（Vercel Web Interface Guidelines 对齐：§7 无障碍与焦点规范、§8 动效合规（prefers-reduced-motion）、§11.5 排版细节、§13 Touch 交互与 URL 状态同步、新增 §14 工程合规规范）
> 本文档是 xopc 所有产品的设计宪法，所有 UI 决策应以此为准。
>
> **工程实现（Gateway 控制台）**：`web/src/styles/globals.css`（Tailwind v4 `@theme`）为语义 token 的单一来源；本文数值与其保持一致。

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
- **Light 模式**：浅灰「分组」底（类似 macOS/iOS grouped background）托底、白面板浮起，通过亮度差区分层级，层级越高越亮
- **Dark 模式**：深灰阶梯（类似 Apple 深色界面 elevated surfaces），避免死黑；层级越高越亮；浮层以边框（rim light）为主、弥散阴影为辅

> **Gateway Web**：中性灰已对齐 **Apple 系统标签 / 表面色阶**（如 `#f5f5f7`、`#1d1d1f`，深色 `#1c1c1e` / `#2c2c2e`）；**品牌蓝**仍为唯一彩色强调，原则不变（见 §2.2）。

---

### 2.1 背景与层级色阶 (Backgrounds & Elevation)

通过灰度色阶的微妙变化来表达界面层级；小组件可辅以柔和阴影（见 §5.2）。

**语义 Token（Tailwind / CSS 变量）** — 实现名称以 `web/src/styles/globals.css` 为准：

| 层级语义 | Utility / 变量 | Light Hex | Dark Hex |
|----------|----------------|-----------|----------|
| 全局底层 App Background | `bg-surface-base` / `--color-surface-base` | `#f5f5f7` | `#1c1c1e` |
| 主内容区 / 卡片面板 | `bg-surface-panel` / `--color-surface-panel` | `#ffffff` | `#2c2c2e` |
| 悬浮 Hover | `bg-surface-hover` / `--color-surface-hover` | `#e8e8ed` | `#3a3a3c` |
| 次级激活 Active | `bg-surface-active` / `--color-surface-active` | `#dcdcde` | `#48484a` |

> **层级规律**：Light 模式下层级越高越亮（白面板 > 浅灰底）；Dark 模式下层级越高越亮（elevated 灰阶梯）。卡片与列表行可再加 `border-edge` / `border-edge-subtle` 编组（见 §2.3）。

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

文本色阶是界面信息层级的骨架，必须严格遵守。**Gateway Web** 使用语义色名（与 Apple 标签层级相近），勿在产品界面中硬编码 `slate-*` 作为主中性色。

| 层级 | Utility / 变量 | Light Hex | Dark Hex | 用途 |
|------|----------------|-----------|----------|------|
| 主要文本 | `text-fg` / `--color-fg` | `#1d1d1f` | `#f5f5f7` | 标题、核心正文、重要数据 |
| 次要文本 | `text-fg-muted` / `--color-fg-muted` | `#6e6e73` | `#a1a1a6` | 正文说明、描述性文字 |
| 辅助文本 | `text-fg-subtle` / `--color-fg-subtle` | `#86868b` | `#8e8e93` | 时间戳、元信息、占位符 |
| 弱化 / 禁用 | `text-fg-disabled` / `--color-fg-disabled` | `#aeaeb2` | `#636366` | 禁用状态、极弱提示 |

**边框色阶：**

| 层级 | Utility / 变量 | Light Hex | Dark Hex | 用途 |
|------|----------------|-----------|----------|------|
| 细边框 | `border-edge-subtle` / `--color-edge-subtle` | `#ebebed` | `#3a3a3c` | 列表项分割、内部细节 |
| 主边框 | `border-edge` / `--color-edge` | `#d2d2d7` | `#48484a` | 卡片、输入框、分割线 |
| 强调边框 | `border-edge-strong` / `--color-edge-strong` | `#bcbcc0` | `#636366` | 需要明确区分的容器 |

> **Dark 模式边框策略**：浮层以 `border-edge` 勾勒轮廓（Rim Light）；弥散阴影在深色下减弱，与 `web` 中 `html.dark` 的 `--shadow-*` 定义一致（见 §5.2）。

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

Gateway 控制台将所有语义 token 写在 **`web/src/styles/globals.css`** 的 `@theme` 与 `html.dark` 中，通过根节点 `.dark` 切换。下列为核心变量名（与代码一致）；完整列表（含语义色 success / danger 等、阴影、圆角）以源文件为准。

```css
/* Light — @theme 内 */
--color-surface-base: #f5f5f7;
--color-surface-panel: #ffffff;
--color-surface-hover: #e8e8ed;
--color-surface-active: #dcdcde;
--color-fg: #1d1d1f;
--color-fg-muted: #6e6e73;
--color-fg-subtle: #86868b;
--color-fg-disabled: #aeaeb2;
--color-edge-subtle: #ebebed;
--color-edge: #d2d2d7;
--color-edge-strong: #bcbcc0;
--color-accent: #2563eb;
--color-accent-hover: #1d4ed8;
--color-accent-soft: #eff6ff;
--color-accent-fg: #2563eb;
--color-scrim: rgb(0 0 0 / 0.36);   /* 模态 / 抽屉遮罩，utility: bg-scrim */

/* 圆角 — 映射到 rounded-*（略大于旧版 slate 系，贴近 macOS 控件） */
--radius-sm: 0.625rem;   /* 10px */
--radius-md: 0.75rem;    /* 12px */
--radius-lg: 0.875rem;   /* 14px */
--radius-xl: 1.125rem;   /* 18px */
--radius-pill: 9999px;

/* 阴影 — utility: shadow-surface | shadow-elevated | shadow-float | shadow-popover */
--shadow-surface: 0 1px 2px rgb(0 0 0 / 0.04), 0 1px 6px rgb(0 0 0 / 0.06);
--shadow-elevated: 0 2px 8px rgb(0 0 0 / 0.06), 0 4px 24px rgb(0 0 0 / 0.08);
--shadow-float: 0 4px 16px rgb(0 0 0 / 0.1), 0 12px 40px rgb(0 0 0 / 0.08);
--shadow-popover: 0 8px 32px rgb(0 0 0 / 0.12), 0 2px 12px rgb(0 0 0 / 0.08);
```

```css
/* Dark — html.dark 内覆盖 */
--color-surface-base: #1c1c1e;
--color-surface-panel: #2c2c2e;
--color-surface-hover: #3a3a3c;
--color-surface-active: #48484a;
--color-fg: #f5f5f7;
--color-fg-muted: #a1a1a6;
--color-fg-subtle: #8e8e93;
--color-fg-disabled: #636366;
--color-edge-subtle: #3a3a3c;
--color-edge: #48484a;
--color-edge-strong: #636366;
--color-accent: #3b82f6;
--color-accent-hover: #60a5fa;
--color-accent-soft: rgb(30 58 138 / 0.55);
--color-accent-fg: #60a5fa;
--color-scrim: rgb(0 0 0 / 0.52);
/* 深色下 --shadow-* 减弱或改为轻描边式，与 border-edge 配合 */
```

**字体变量（同文件 `@theme`）**

```css
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui,
  "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC",
  "Microsoft YaHei", 微软雅黑, sans-serif;
--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

## 3. 排版规范 (Typography)

### 排版哲学
xopc 是知识工作者长时间使用的工具，排版必须服务于**长时间阅读的舒适性**和**信息的快速扫描**。**不引入外部 UI 正文字体**：界面与正文统一走**系统字体栈**，在 Apple 平台上即 **San Francisco（SF Pro）** 与 **苹方**，保证原生感与渲染性能；其他平台回退至 Segoe UI、Roboto 与思源/微软雅黑等。

### 3.1 字体家族 (Font Family)

**Gateway Web** 在 `web/src/styles/globals.css` 的 `@theme` 中定义 `--font-sans` / `--font-mono`，与 Tailwind `font-sans`、`font-mono` 对齐。

```css
/* 与 globals.css 一致 */
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui,
  "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC",
  "Microsoft YaHei", 微软雅黑, sans-serif;
--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

| 字体 | Token | 用途 |
|------|-------|------|
| **系统 UI 栈（含 SF Pro / 苹方等）** | `font-sans` | 所有 UI 文字、正文、标题（默认） |
| **等宽栈（含 SF Mono 等）** | `font-mono` | 代码片段、数字序列、知识库 ID、文件路径 |

> **中文说明**：`PingFang SC`、`Hiragino Sans GB` 保障 Apple 中文；`Noto Sans CJK SC`、`Microsoft YaHei`（微软雅黑）覆盖其他平台。

> **Tailwind v4**：字体在 `@theme` 中扩展，无需单独的 `tailwind.config.js` `fontFamily` 片段；以 `globals.css` 为准。

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

**Gateway Web 基线**：`html` 保持 **16px**（`rem` 基准）；`body` 默认继承字号为 **15px**（`0.9375rem`）、`line-height: 1.47059`，与 SF 常见 UI 行高一致。组件仍优先用 `text-sm` / `text-base` 等工具类明确字阶。

### 3.3 字重使用规范 (Font Weight)
- `font-normal` (400) — 正文、说明文字
- `font-medium` (500) — UI 操作文字、次级标题、强调词
- `font-semibold` (600) — 页面标题、重要数据、主要标题
- **禁止使用** `font-bold` (700) 及以上 — 过于厚重，破坏优雅感

### 3.4 字间距 (Letter Spacing)
- 大标题必须加 `tracking-tight`（-0.025em），避免标题字母间距过松显得廉价
- 正文和 UI 文字：全局可对 `body` 使用极轻负字距（Gateway Web 为 `-0.006em`），与系统 UI 气质一致；**Markdown 正文**可用约 `-0.011em`（见 `web/src/features/chat/markdown/markdown.css`）
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

- **左侧导航**：使用较「底」的一层（`bg-surface-base`），与全局底或主区形成区块感。
- **右侧主内容区**：使用较「浮」的一层（`bg-surface-panel`），作为阅读与操作的主表面。
- **不要做**：在侧栏与主内容之间加 **整根竖向 border** 或把整个壳包进 **粗外框**，用线去切「大块」区域。
- **仍要做**：列表行、卡片、表格单元、输入框、模态与抽屉等 **内层组件** 可以继续使用细边框、分割线（见 2.3、5.2、10.2），用于局部编组与可读性。

**一句话**：**大布局靠色块、无声；小组件可以用线。**

### 4.3 侧栏「任务 / 会话」列表（Gateway Web）

左侧可滚动的会话列表属于 **工作台模式** 下的高密度区，遵循 §4 的 **8pt 网格**，在 **紧凑** 与 **可扫读** 之间平衡：

- **项间距**：相邻会话行之间用 **`gap-1.5`（6px）** 左右即可，**不要**用过大的 `gap-3`+；也避免 `gap-0.5`（2px）过粘。
- **单行内边距**：宜 **偏小**（如 `px-2 py-1.5`），避免厚内边距把行撑得过肥、显得项与项之间「挤」；命中区仍靠整行可点保证。
- **列表水平内边距**：`px-2.5`～`px-3` 与主导航对齐即可。
- **字阶**：保持 `text-sm` + `leading-6`（见 §3.2 UI 字阶）。

---

## 5. 形状与阴影 (Shapes & Elevation)

### 5.1 有机感圆角 (Border Radius)
圆角是传递"亲切感"的核心元素。xopc 选择有机感（圆润）风格，圆角比例偏大。

| 元素类型 | Token | 大小 | 说明 |
|----------|-------|------|------|
| 卡片、弹窗、大容器 | `rounded-xl` / `rounded-2xl` | 以 `@theme` `--radius-xl`（18px）等为基准 | 主要容器；具体 class 与组件一致 |
| 按钮、输入框 | `rounded-xl` | 映射 `--radius-xl`（18px）或略小一级 | 交互组件，亲切但不失专业 |
| **分段控件**（顶栏语言 / 主题、列表网格切换等） | 轨道 `rounded-full` + 滑块 `rounded-full` | CSS `--radius-pill` → `rounded-pill` | 灰色轨道 (`bg-surface-hover`)、浅色浮起滑块 (`bg-surface-panel` + 轻阴影)，与参考图一致的大圆角「胶囊」语义，不是直角分段 |
| 小型标签、Badge | `rounded-lg` | 映射 `--radius-lg`（14px） | 微小元素 |
| 头像、图标容器 | `rounded-full` | 50% | 完全圆形，用于人物和品牌标识 |

**分段控件实现约定（Gateway / Web）**：轨道与每项使用同一套 class，避免顶栏各开关风格漂移。共享常量见 `web/src/components/ui/segmented-styles.ts`（`segmentedTrackClassName`、`segmentedThumbBaseClassName`、`segmentedThumbActiveClassName`）。选中项需要强调色时在外层追加 `text-accent-fg`（如主题、图标型分段）。

> **有机感原则**：圆角应该让人感觉"柔软"，而不是"锋利"。当你不确定用多大圆角时，选更大的那个。

### 5.2 阴影策略 (Shadows)
克制使用阴影。通过**多层、低对比**的弥散阴影区分层级，避免深色硬阴影。

- **应用壳（侧栏 / 主区）**: 不靠阴影也不靠大块边框分割，靠背景色阶（见 [4.2](#42-应用壳左侧导航与主工作区区块色块与边框边界)）。
- **主区内的默认卡片**: 可无阴影，靠 `border-edge` / `border-edge-subtle` 与表面色区分（指内容区内的卡片，不是壳层分区）。
- **浅色模式 — 语义阴影类（Tailwind）**：
  - `shadow-surface`：内嵌卡片、输入条（如对话 composer 外框）
  - `shadow-elevated`：菜单、Popover、下拉
  - `shadow-float`：悬浮按钮等强调浮起
  - `shadow-popover`：较大浮层（与 `shadow-elevated` 可按场景二选一，保持全站一致即可）
- **深色模式**：阴影减弱，常与 `border-edge` 并用；具体数值见 `html.dark` 内 `--shadow-*`。
- **模态遮罩**：统一 `bg-scrim`（`--color-scrim`），勿再硬编码 `bg-slate-900/40` 等。

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
- **导航/功能图标**：`text-fg-subtle`，激活时 `text-fg`
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
| **Hover** | 鼠标悬浮 | `bg-surface-hover`，`transition-colors duration-150` |
| **Active / Pressed** | 点击按下 | `scale-95`，模拟按压手感 |
| **Focus** | 键盘聚焦 | `focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`，永远不能去掉 |
| **Disabled** | 禁用态 | `opacity-50 cursor-not-allowed`，不响应任何交互 |
| **Loading** | 加载中 | 替换内容为 spinner 或骨架屏，保持组件尺寸不变 |

> **焦点规范**：必须使用 `:focus-visible` 而非 `:focus`——鼠标点击不显示焦点环，键盘导航才显示。**严禁** `outline-none` / `outline: none` 在没有等效替代的情况下出现。复合控件（如搜索框 + 下拉）使用 `:focus-within` 统一高亮外层容器。

### 7.2 无障碍要求 (Accessibility)

所有交互组件在实现时必须满足以下无障碍规范：

| 场景 | 要求 | 示例 |
|------|------|------|
| 图标按钮（无文字） | 必须有 `aria-label` | `<button aria-label="关闭">…</button>` |
| 装饰性图标 | 必须有 `aria-hidden="true"` | `<Icon aria-hidden="true" />` |
| 表单控件 | 必须有 `<label>` 或 `aria-label` | `<label htmlFor="search">搜索</label>` |
| 异步更新（Toast、验证） | 必须有 `aria-live="polite"` | `<div aria-live="polite">…</div>` |
| 操作触发 | 用 `<button>`，导航跳转用 `<a>` / `<Link>` | 禁止 `<div onClick>` 代替 |
| 标题层级 | 页面内 `<h1>`–`<h6>` 层级连续，不跳级 | 主内容区提供 skip link |

### 7.3 按钮变体规范

**主要按钮 (Primary)** — 每页最多 1 个，代表最重要的操作
```
bg-accent text-white rounded-xl px-4 py-2 text-sm font-medium
hover:bg-accent-hover active:scale-95
transition-colors duration-150 ease-out
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base
disabled:opacity-50 disabled:cursor-not-allowed
```

> ⚠️ **禁止 `transition-all`**：按钮 transition 只列明需要的属性（`transition-colors`、`transition-transform`），避免触发不必要的布局计算。

**次要按钮 (Secondary)** — 辅助操作
```
bg-surface-panel text-fg border border-edge rounded-xl px-4 py-2 text-sm font-medium
hover:bg-surface-hover active:scale-95
transition-colors duration-150 ease-out
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
```

**幽灵按钮 (Ghost)** — 最低视觉权重，用于工具栏、列表操作
```
text-fg-muted rounded-xl px-3 py-1.5 text-sm font-medium
hover:bg-surface-hover hover:text-fg active:scale-95
transition-colors duration-150 ease-out
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
```

**危险按钮 (Destructive)** — 删除、清空等不可逆操作
```
bg-red-600 text-white rounded-xl px-4 py-2 text-sm font-medium
hover:bg-red-700 active:scale-95
transition-colors duration-150 ease-out
```

> ⚠️ **破坏性操作必须二次确认**：删除、清空等不可逆操作必须弹出确认对话框或提供撤销窗口，**严禁**点击后立即执行。

### 7.4 输入框规范

```
bg-surface-panel border border-edge rounded-xl px-3 py-2 text-sm text-fg
placeholder:text-fg-subtle
hover:border-edge-strong
focus:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent
disabled:bg-surface-hover disabled:text-fg-disabled disabled:cursor-not-allowed
```

**表单输入框工程规范：**
- 必须提供 `autocomplete` 属性（非认证字段用 `autocomplete="off"` 避免密码管理器干扰）
- 根据内容类型设置正确的 `type`（`email`、`tel`、`url`、`number`）和 `inputmode`
- **严禁**通过 `onPaste` + `preventDefault` 阻止用户粘贴
- 邮箱、验证码、用户名输入框加 `spellCheck={false}`
- `placeholder` 文字以 `…` 结尾并展示示例格式，如 `搜索会话…`
- 错误信息内联显示在字段下方，提交时自动聚焦到第一个错误字段
- 提交按钮在请求发起前保持可用，请求进行中显示 spinner

**复选框（原生 `<input type="checkbox">`）**

- **不要用品牌蓝作选中填充**：`text-accent` / 误用会把勾选块做成高饱和主色块，和「表面中性 + 蓝仅用于主按钮/链接」冲突，易显花哨。
- **做法**：用语义变量 `--color-checkbox-accent`（浅灰黑 / 深灰白）控制 `accent-color`，Web 侧统一类名 `ui-checkbox`（见 `web/src/styles/globals.css`）。未选：与输入框一致的 `border-edge` + `bg-surface-panel`；选：中性填充，键盘聚焦仍跟全局 `focus-visible` 环。
- **质感**：克制、偏系统设置类控件；需要强确认的勾选仍靠文案与布局，不靠彩色块。

---

## 8. 动效与交互 (Motion & Interaction)

### 8.1 动效哲学
动效是为了**传达信息**，不是为了炫技。每一个动效都应该回答："这个动效让用户更清楚发生了什么吗？"如果答案是否定的，去掉它。

### 8.2 动效规范

| 场景 | Token | 时长 | 说明 |
|------|-------|------|------|
| 颜色/背景切换 | `transition-colors duration-150 ease-out` | 150ms | 悬浮、激活态切换 |
| 尺寸/位移变化 | `transition-transform duration-200 ease-out` | 200ms | 展开/收起、位移 |
| 弹窗/面板出现 | `transition-opacity transition-transform duration-300 ease-out` | 300ms | 模态框、抽屉 |
| 按压反馈 | `active:scale-95` | 即时 | 所有按钮和可点击卡片必须有 |
| 微上浮 | `hover:-translate-y-0.5` | 配合 200ms | 卡片悬浮时的轻微上浮 |

**动效工程规范（强制）：**

- **仅动画 `transform` 和 `opacity`**：这两个属性由 GPU 合成层处理，不触发布局重排。禁止动画 `width`、`height`、`top`、`left`、`padding`、`margin` 等会触发 layout 的属性。
- **禁止 `transition: all`**：必须明确列出需要过渡的属性（如 `transition-colors`、`transition-transform`），避免意外触发不必要的计算。
- **动效必须可中断**：用户在动效进行中触发新操作时，动效应立即响应，不阻塞交互。
- **SVG 动效**：在 `<g>` 包装元素上应用 transform，并设置 `transform-box: fill-box; transform-origin: center`，确保变换基点正确。

### 8.3 减弱动效模式 (Reduced Motion)

**必须**尊重用户的系统级"减弱动效"偏好设置：

```css
/* globals.css 中全局声明 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

在 React 组件中检测：
```typescript
const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;
```

> ⚠️ **设计反模式**：`prefers-reduced-motion` 未处理是无障碍合规的硬性要求，不是可选项。对于有前庭障碍的用户，未处理的动效可能引发身体不适。

### 8.4 无障碍焦点 (Focus State)
永远不要去掉键盘焦点轮廓。使用统一规范：
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
```

> 使用 `:focus-visible` 而非 `:focus`：鼠标点击不显示焦点环，键盘 Tab 导航才显示，避免视觉干扰。

---

## 9. 空状态与加载态 (Empty & Loading States)

空状态和加载态是产品"亲切感"最关键的时刻。用户在这里最脆弱，设计必须给予安慰和引导。

### 9.1 空状态设计规范

空状态必须包含三个要素：**图标 + 标题 + 行动引导**，缺一不可。

```
结构：
[48px Lucide 图标，text-fg-disabled]
[标题，text-fg text-lg font-semibold，mt-4]
[说明文字，text-fg-subtle text-sm，mt-2，max-w-xs text-center]
[主要操作按钮，mt-6]（可选，但强烈推荐）
```

**各模块空状态文案示例：**
- **知识库为空**：图标 `BookOpen`，标题"开始构建你的知识库"，说明"把你读过的文章、想法、笔记都放在这里，让 AI 帮你连接它们。"
- **项目为空**：图标 `Layers`，标题"创建你的第一个项目"，说明"用轻项目组织你的想法和行动，一个项目就是一个推进中的故事。"
- **搜索无结果**：图标 `Search`，标题"没有找到相关内容"，说明"试试换个关键词，或者让 AI 帮你搜索。"

### 9.2 加载态规范

**骨架屏 (Skeleton)** — 用于列表、卡片等有固定结构的内容
- 使用 `bg-surface-active animate-pulse rounded-lg`（或 `bg-edge`）模拟内容形状
- 骨架屏的形状必须与真实内容的布局一致，不能随意画矩形
- 颜色：亮色可用 `bg-surface-active`，暗色可用 `bg-surface-hover`，与表面层级一致即可

**行内 Spinner** — 用于按钮点击后的等待、局部数据刷新
- 使用 Lucide 的 `Loader2` 图标配合 `animate-spin`
- 大小与按钮内图标一致（16px）
- 按钮加载时：禁用按钮 + 替换文字为 spinner + 保持按钮宽度不变（避免布局抖动）

**全屏加载** — 仅用于应用初始化，不用于页面切换
- 居中显示品牌 Logo + 细线进度条
- 超过 3 秒必须显示"加载较慢，请检查网络"的友好提示

---

## 10. 暗色模式体系 (Dark Mode)
遵循**深邃但不死黑**的原则。**Gateway Web** 采用与 Apple 深色界面相近的 **elevated gray**（`#1c1c1e` / `#2c2c2e` 阶梯），而非偏蓝的 slate 堆栈；语义上仍满足「层级越高越亮」。

### 10.1 背景与层级映射 (Dark Backgrounds)
在暗色模式下，层级越高的元素（离用户越近的元素），背景色应该越亮。

- **全局背景**: `bg-surface-base`（`#1c1c1e`）— 最远基底
- **卡片/主内容面板**: `bg-surface-panel`（`#2c2c2e`）— 相对浮起
- **悬浮/激活态**: `bg-surface-hover` / `bg-surface-active`
- **侧边栏**: `bg-surface-base` — 与主内容区用 **相邻背景色阶** 区分（与 [4.2](#42-应用壳左侧导航与主工作区区块色块与边框边界) 一致），**不依赖**侧栏与主区之间的竖向大边框

### 10.2 文本与边框翻转 (Dark Typography & Borders)
- **主要文本**: `text-fg`（`#f5f5f7`）
- **次要文本**: `text-fg-muted`
- **辅助文本**: `text-fg-subtle`
- **弱化 / 禁用**: `text-fg-disabled`
- **边框**: `border-edge` / `border-edge-subtle` — 用于 **内层** 列表、卡片、输入框等；**应用壳** 层级仍以背景色阶为主，边框为辅（见 [4.2](#42-应用壳左侧导航与主工作区区块色块与边框边界)）

### 10.3 色彩适应 (Color Adaptation)
暗色模式下的彩色需要稍微"提亮"以保证对比度。

- **主色**: `dark:bg-blue-500` — 比亮色模式的 blue-600 更亮，保证可见性
- **柔和主色**: `dark:bg-blue-900/40` 配合 `dark:text-blue-400`
- **语义色彩**: 均调整为高亮文字 + 极暗透明背景。例如成功：`dark:text-emerald-400 dark:bg-emerald-950/50`

### 10.4 阴影策略 (Dark Shadows)
- **减轻弥散阴影**：深底上过重阴影易显脏；`html.dark` 内 `--shadow-*` 已整体减弱
- **发光描边配合**：弹窗和浮层可采用 `dark:shadow-none`（或轻阴影）+ `border-edge` + `bg-surface-panel`，用微弱亮边勾勒轮廓（Rim Light）

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

- AI 正在思考：**"正在分析…"** 而不是 "AI 正在努力为您处理中..."
- AI 给出建议：**"基于你的笔记，这里有一些关联"** 而不是 "AI 为您智能推荐了以下内容"
- AI 操作完成：**"完成"** 或 **"已整理"** — 简洁，不强调是 AI 做的
- 引导使用 AI：**"让 AI 帮你深入研究这个话题"** — 自然，像朋友的建议

### 11.4 数字与单位
- 时间：使用相对时间，"3 分钟前"、"昨天"、"上周"，而不是绝对时间戳；使用 `Intl.DateTimeFormat` 格式化，**禁止**硬编码日期格式字符串
- 数量：超过 999 用 "1k"、"2.3k"，保持简洁；使用 `Intl.NumberFormat` 格式化数字，**禁止**硬编码千分位分隔符
- 进度：用百分比或分数，"3/10 完成" 比 "30%" 更有成就感
- 数字列（表格中对比数值）：使用 `font-variant-numeric: tabular-nums`（Tailwind: `tabular-nums`），保证数字对齐

### 11.5 排版细节规范 (Typography Details)

这些细节决定了产品的精致感，必须在代码和文案中严格执行：

| 规范 | 正确 ✅ | 错误 ❌ | 说明 |
|------|---------|---------|------|
| **省略号** | `…`（单字符 U+2026） | `...`（三个英文句点） | 用 HTML `&hellip;` 或直接输入 `…` |
| **加载状态** | `"正在保存…"` | `"正在保存..."` | 省略号规则同上 |
| **引号** | `"内容"` `'内容'` | `"内容"` `'内容'` | 使用弯引号，非直引号 |
| **不换行空格** | `⌘&nbsp;K`、`10&nbsp;MB` | `⌘ K`、`10 MB` | 快捷键、数字+单位之间用 `&nbsp;` |
| **标题换行** | `text-wrap: balance` / `text-pretty` | 无处理 | 防止标题最后一行只剩一个词（孤字） |
| **主动语态** | "安装 CLI" | "CLI 将被安装" | 按钮、操作指引用主动语态 |
| **按钮标签** | "保存 API 密钥" | "继续" / "确认" | 标签必须描述具体操作结果 |
| **错误信息** | "上传失败，文件超过 10&nbsp;MB 限制" | "上传失败" | 必须包含修复步骤或原因 |

**标题排版：** 在 `<h1>`–`<h3>` 等标题元素上添加 `text-wrap: balance`（Tailwind: `text-balance`），防止孤字断行：
```css
h1, h2, h3 {
  text-wrap: balance;
}
```

---

## 12. Logo 与品牌标识 (Logo & Brand Identity)

### 12.1 Logo 设计原则
基于**有机感**风格，Logo 应具备以下特征：
- **圆润**：主要形状使用圆角或圆形，避免尖锐的直角
- **简洁**：单色可识别，在 16px 的 favicon 尺寸下依然清晰
- **有记忆点**：与"工作站"、"个人操作系统"的概念有视觉关联
- **可延展**：能在深色/浅色背景上都表现良好

### 12.2 品牌色在 Logo 中的应用
- **主版本**：深色 Logo（与 `text-fg` / `#1d1d1f` 同级）用于浅色背景
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

#### 设计 Token 与静态资源

- **单一来源**：颜色、圆角、阴影、字体栈以 `web/src/styles/globals.css` 为准；`index.html` 已声明 `<meta name="color-scheme" content="light dark" />`，便于表单控件与系统主题协调。

#### Web 端特有规范
- **键盘快捷键**：所有核心操作必须有快捷键，并在 Tooltip 中显示（如 `⌘&nbsp;K` 打开命令面板）
- **悬浮 Tooltip**：所有图标按钮必须有 Tooltip，延迟 400ms 显示，避免打扰快速操作
- **右键菜单**：列表项、卡片支持右键上下文菜单，提供快捷操作
- **拖拽排序**：项目列表、知识库条目支持拖拽排序；拖拽进行中禁用文字选中，被拖拽元素加 `inert` 属性
- **URL 状态同步**：筛选条件、激活的 Tab、分页、展开的面板等状态必须同步到 URL query params，支持深链接和浏览器前进/后退
- **暗色模式 meta**：`<html>` 元素在暗色模式下需设置 `color-scheme: dark`（已在 `globals.css` 中处理）；`<meta name="theme-color">` 随主题切换更新，匹配页面背景色
- **大列表性能**：超过 50 条的列表（如会话列表、知识库条目）必须使用虚拟滚动（`virtua` 或 `content-visibility: auto`），禁止直接 `.map()` 渲染全量数据
- **字体预加载**：关键字体文件使用 `<link rel="preload" as="font" crossorigin>` 预加载；CDN / 资产域名使用 `<link rel="preconnect">` 预连接

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

#### Phone 端触摸交互规范
- **`touch-action: manipulation`**：所有可点击元素必须设置，消除双击缩放延迟（300ms tap delay）
- **`-webkit-tap-highlight-color`**：设置为 `transparent` 或品牌色，禁止使用系统默认的灰色高亮
- **模态 / 抽屉 / 底部面板**：必须设置 `overscroll-behavior: contain`，防止滚动穿透到底层页面
- **Safe Area（刘海 / 圆角屏）**：全出血布局必须使用 `env(safe-area-inset-*)` 适配，底部 Tab 导航高度 = 49pt + `env(safe-area-inset-bottom)`
- **禁止 `user-scalable=no`**：不得在 `<meta name="viewport">` 中设置 `user-scalable=no` 或 `maximum-scale=1`，这会阻止无障碍缩放
- **`autoFocus`**：Phone 端禁止使用 `autoFocus`，避免键盘意外弹起影响布局

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
| **色彩系统** | 完全共享第 2 章；Gateway Web 以 `web/src/styles/globals.css` 语义色为准，Light/Dark 双模式 |
| **字体家族** | 完全共享第 3 章的系统字体栈 |
| **圆角风格** | 有机感大圆角；Web 以 `@theme` `--radius-*` 为准（如 `rounded-xl` 对应 18px 档），Phone 与 Web 保持同一套比例关系 |
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

---

---

## 14. 工程合规规范 (Engineering Compliance)

> 本章是 Vercel Web Interface Guidelines 与 xopc 设计系统的对齐层，将行业最佳实践转化为 xopc 工程团队的强制执行规范。所有 PR 在 Code Review 时应对照本章进行检查。

### 14.1 无障碍合规 (Accessibility)

无障碍不是可选项，是产品质量的基线。

| 规则 | 要求 | 反模式 |
|------|------|--------|
| 图标按钮 | 必须有 `aria-label` | `<button><Icon /></button>` 无标签 |
| 装饰图标 | 必须有 `aria-hidden="true"` | 装饰图标被屏幕阅读器读出 |
| 表单控件 | 必须有 `<label htmlFor>` 或 `aria-label` | 无标签的裸 `<input>` |
| 异步更新 | Toast、验证错误区域需 `aria-live="polite"` | 动态内容屏幕阅读器无法感知 |
| 语义 HTML | 优先使用 `<button>`、`<a>`、`<label>`、`<table>` | `<div onClick>` 代替按钮 |
| 标题层级 | `<h1>`–`<h6>` 层级连续，不跳级 | 从 `<h1>` 直接跳到 `<h4>` |
| Skip Link | 主内容区提供跳过导航的 skip link | 键盘用户必须 Tab 遍历整个导航 |
| 图片 | 必须有 `alt`；纯装饰图片用 `alt=""` | 无 `alt` 属性的 `<img>` |

### 14.2 焦点管理 (Focus Management)

```css
/* 正确：仅键盘导航时显示焦点环 */
.interactive-element:focus-visible {
  outline: none;
  ring: 2px solid var(--color-accent);
  ring-offset: 2px;
}

/* 错误：永远不要这样做 */
.interactive-element:focus {
  outline: none; /* ❌ 无替代的 outline-none */
}
```

- 使用 `:focus-visible` 而非 `:focus`，鼠标点击不显示焦点环，键盘导航才显示
- 复合控件（搜索框 + 下拉）使用 `:focus-within` 统一高亮外层容器
- **严禁** `outline-none` / `outline: 0` 在没有等效 `focus-visible` 替代的情况下出现

### 14.3 内容溢出处理 (Content Overflow)

文本容器必须处理长内容，防止布局破坏：

```tsx
// 单行截断
<p className="truncate">长文本内容…</p>

// 多行截断
<p className="line-clamp-2">多行长文本内容…</p>

// Flex 子元素必须加 min-w-0 才能截断
<div className="flex gap-2">
  <span className="min-w-0 truncate">可能很长的标题</span>
  <Badge>标签</Badge>
</div>
```

**规则：**
- Flex / Grid 子元素中的文本容器必须加 `min-w-0`，否则 `truncate` 不生效
- 所有用户生成内容（UGC）的容器必须处理：短文本、正常文本、超长文本三种情况
- 空字符串 / 空数组不得渲染破损的 UI，必须有空状态处理（见 §9.1）

### 14.4 图片规范 (Images)

```tsx
// 正确
<img src={url} alt="描述" width={400} height={300} loading="lazy" />

// 首屏关键图片
<img src={hero} alt="描述" width={800} height={600} fetchpriority="high" />
```

- 所有 `<img>` 必须有明确的 `width` 和 `height`，防止 CLS（累积布局偏移）
- 首屏以下图片加 `loading="lazy"`
- 首屏关键图片加 `fetchpriority="high"` 或 `priority`（Next.js Image）

### 14.5 性能规范 (Performance)

**大列表虚拟化：**
- 超过 50 条的列表（会话列表、知识库条目、日志列表等）**必须**使用虚拟滚动
- 推荐使用 `virtua` 库，或 CSS `content-visibility: auto`
- **禁止**对大数组直接 `.map()` 渲染全量 DOM

**资源预加载：**
```html
<!-- CDN / 资产域名预连接 -->
<link rel="preconnect" href="https://assets.xopc.ai" />

<!-- 关键字体预加载 -->
<link rel="preload" href="/fonts/sf-pro.woff2" as="font" type="font/woff2" crossorigin />
```

**受控输入性能：**
- 优先使用非受控输入（`defaultValue`）；受控输入（`value` + `onChange`）必须保证每次 keystroke 的处理开销极低
- 禁止在 render 阶段读取 `getBoundingClientRect`、`offsetHeight`、`scrollTop` 等触发强制布局的属性

### 14.6 导航与状态 (Navigation & State)

**URL 状态同步：**
- 筛选条件、激活 Tab、分页、展开面板等状态必须同步到 URL query params
- 支持深链接（用户可以分享当前状态的 URL）和浏览器前进/后退
- 推荐使用 `nuqs` 或类似库管理 URL 状态

**链接语义：**
- 所有导航跳转使用 `<a>` / `<Link>`，支持 Cmd+Click 新标签打开
- 操作触发使用 `<button>`，**禁止**用 `<div>` 或 `<span>` 绑定 `onClick` 做导航

**破坏性操作保护：**
- 删除、清空、重置等不可逆操作必须弹出确认对话框，或提供撤销窗口（≥5 秒）
- **严禁**点击后立即执行不可逆操作
- 有未保存更改时，导航离开前必须提示（`beforeunload` 或路由守卫）

### 14.7 暗色模式工程规范 (Dark Mode Engineering)

```html
<!-- index.html 中已声明，确保表单控件与系统主题协调 -->
<meta name="color-scheme" content="light dark" />

<!-- 随主题切换更新，匹配页面背景色 -->
<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1c1c1e" media="(prefers-color-scheme: dark)" />
```

- `<html>` 在暗色模式下需有 `color-scheme: dark`（`globals.css` 中 `html.dark` 已处理）
- 原生 `<select>` 在 Windows 暗色模式下需显式设置 `background-color` 和 `color`，否则文字不可见

### 14.8 工程反模式速查 (Anti-patterns Checklist)

Code Review 时，以下模式一经发现必须修复：

| ❌ 反模式 | ✅ 正确做法 |
|-----------|------------|
| `user-scalable=no` / `maximum-scale=1` | 移除，允许无障碍缩放 |
| `onPaste` + `preventDefault` 阻止粘贴 | 移除阻止，允许用户粘贴 |
| `transition: all` | 明确列出属性：`transition-colors`、`transition-transform` |
| `outline-none` 无 `focus-visible` 替代 | 加 `focus-visible:ring-2 focus-visible:ring-accent` |
| `<div onClick>` 做按钮 | 改为 `<button>` |
| `<div onClick>` 做导航 | 改为 `<a>` / `<Link>` |
| 图片无 `width` / `height` | 加明确尺寸，防止 CLS |
| 大数组 `.map()` 无虚拟化 | 超过 50 条使用 `virtua` 或 `content-visibility` |
| 表单无 `<label>` | 加 `<label htmlFor>` 或 `aria-label` |
| 图标按钮无 `aria-label` | 加 `aria-label="操作描述"` |
| 硬编码日期格式 `"YYYY-MM-DD"` | 使用 `Intl.DateTimeFormat` |
| 硬编码数字格式 `","` 分隔符 | 使用 `Intl.NumberFormat` |
| `autoFocus` 在移动端 | 移除，或仅在桌面端启用 |
| 省略号用 `...` | 改为 `…`（U+2026） |
| 直引号 `"` / `'` | 改为弯引号 `"` `"` / `'` `'` |

---

_Last updated: 2026-03-26_
