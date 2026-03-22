# 产品设计系统 (Design System)

## 1. 设计价值观 (Design Values)
- **清晰 (Clear)**: 明确的视觉层级，信息传达无歧义。克制色彩使用，突出重点。
- **灵活 (Flexible)**: 高度模块化的组件，依托 Tailwind 的 Utility-first 特性，快速适应各种业务场景。
- **干净 (Clean)**: 极简的灰度背景托底，抛弃厚重的边框和阴影，增加界面“呼吸感”。
- **亲切 (Friendly)**: 苹果风格的平滑大圆角，配合理智且温和的弹性交互动效。

---

## 2. 色彩规范 (Color Palette)

### 2.1 托底与背景色 (Backgrounds)
采用极简灰度托底，让内容模块（卡片）在界面上呈现干净的悬浮感。
- **全局背景 (App Background)**: `bg-slate-50` (极浅的灰蓝色，比纯白更护眼、更有质感)
- **卡片/容器 (Card/Container)**: `bg-white` (纯白卡片在灰色背景上形成干净的轻微对比)
- **悬浮/激活背景 (Hover/Active)**: `bg-slate-100`

### 2.2 主色调 (Primary Colors)
理智温和的蓝色系，传递专业、科技与可信赖感，但不过分刺眼。
- **主色 (Primary Base)**: `bg-blue-600` (用于核心操作按钮、关键状态强调)
- **悬浮态 (Primary Hover)**: `bg-blue-700`
- **浅柔态 (Primary Soft)**: `bg-blue-50` (配合 `text-blue-600`，用于次要按钮或选中状态，非常“亲切”)

### 2.3 文本与中性色 (Typography & Neutrals)
- **主要文本 (Primary Text)**: `text-slate-900` (大标题、核心正文，避免绝对的纯黑 `#000`)
- **次要文本 (Secondary Text)**: `text-slate-500` (辅助说明、时间戳、占位符)
- **弱化/禁用文本 (Disabled Text)**: `text-slate-400`
- **边框与分割线 (Borders)**: 默认 `border-slate-200`，更细微的分割用 `border-slate-100`

### 2.4 语义色彩 (Semantic Colors)
用于传达明确的状态信息，保持克制，通过浅色背景加深色文字提升亲切感。
- **成功 (Success)**: 强调 `text-emerald-600`，柔和背景 `bg-emerald-50`
- **危险/错误 (Destructive/Error)**: 强调 `text-red-600`，柔和背景 `bg-red-50` (用于删除、严重警告操作)
- **警告 (Warning)**: 强调 `text-amber-600`，柔和背景 `bg-amber-50`

---

## 3. 排版规范 (Typography)
排版是传递信息的骨架。我们优先使用系统原生字体以获得最佳性能与跨平台一致性。

### 3.1 字体家族 (Font Family)
- **系统无衬线 (Sans-serif)**: `font-sans` (默认)。优先使用苹果系的 `San Francisco` 或现代无衬线体 `Inter`。
- **等宽数字/代码 (Monospace)**: `font-mono`。用于代码片段、对齐的数字序列、订单号、金额等，保证垂直对齐。

### 3.2 字号与行高 (Sizes & Leading)
遵循严谨的层级关系，行高需给文本足够的呼吸空间。
- **页面标题 (Title)**: `text-2xl font-semibold tracking-tight` (用于页面主标题)
- **模块/卡片标题 (Heading)**: `text-lg font-medium` (用于内容区块标题)
- **常规内容 (Base)**: `text-base leading-relaxed` (主要阅读段落，16px)
- **界面操作文本 (UI Text)**: `text-sm leading-6` (按钮、输入框、列表项，14px，最常用，紧凑专业)
- **辅助文本 (Caption)**: `text-xs leading-5` (标签、时间、微小注释，12px)

---

## 4. 间距与布局 (Spacing & Layout)
基于 **8pt 网格系统 (8-Point Grid)**，保证视觉律动感和开发的一致性。

- **组件内微间距 (Micro)**: `4px (p-1)` 或 `8px (p-2)` (如：图标与相邻文字之间)
- **常规间距 (Normal)**: `16px (p-4)` 或 `24px (p-6)` (如：卡片的内边距，表单上下间距)
- **区块间距 (Section)**: `32px (p-8)` 或 `48px (p-12)` (如：页面中不同模块的逻辑隔离)

---

## 5. 形状与阴影 (Shapes & Elevation)

### 5.1 苹果风平滑大圆角 (Border Radius)
圆角是传递“亲切感”的核心元素。
- **卡片、弹窗、大容器 (Cards / Modals)**: `rounded-2xl` (16px) 或 `rounded-3xl`
- **按钮、输入框、交互组件 (Buttons / Inputs)**: `rounded-xl` (12px) 或完全圆角 `rounded-full`
- **微小元素 (Tags, Badges)**: `rounded-lg` (8px)

### 5.2 阴影 (Shadows)
克制使用深色硬阴影。通过大面积、低透明度的弥散阴影来区分层级。
- **默认卡片**: 无阴影或极微弱阴影 `shadow-sm`，主要靠 `border border-slate-100` 与灰色背景区分。
- **悬浮/弹出层 (Dropdowns / Popovers)**: `shadow-xl shadow-slate-200/50` (非常柔和的弥散投影)
- **模态弹窗 (Modals)**: `shadow-2xl shadow-slate-900/10` (更深的高层级投影，强化视觉焦点)

---

## 6. 动效与交互 (Motion & Interaction)
- **悬浮过渡 (Hover Transition)**: `transition-all duration-200 ease-out` (快速、平滑)
- **点击反馈 (Active State)**: 所有按钮和卡片在点击时必须有“微缩放”效果 `active:scale-95`，模拟按压真实柔软物体的亲切手感。
- **位移反馈**: 配合 Hover 使用细微上浮 `hover:-translate-y-0.5` 增加界面的灵活性。
- **无障碍焦点 (Focus State)**: 永远不要去掉键盘焦点轮廓。使用 `focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2` 提供清晰、优雅的键盘导航高亮，彰显专业度。

---

## 7. 暗色模式体系 (Dark Mode)
遵循“深邃但不死黑”的原则。不使用纯黑 (`#000`)，而是基于深灰蓝 (`slate-900/950`) 打造具有呼吸感和层次感的黑夜映射。

### 7.1 背景与层级映射 (Dark Backgrounds)
在暗色模式下，层级越高的元素（离用户越近的元素），背景色应该越亮。
- **全局背景 (App Background)**: `dark:bg-slate-950` (极深的午夜蓝灰，作为无穷远的基底)
- **卡片/容器 (Card/Container)**: `dark:bg-slate-900` (对比出微弱的悬浮感)
- **悬浮/激活态 (Hover/Active)**: `dark:bg-slate-800`

### 7.2 文本与边框翻转 (Dark Typography & Borders)
- **主要文本**: `dark:text-slate-50` (接近纯白，但在暗色背景下不刺眼)
- **次要文本**: `dark:text-slate-400`
- **弱化文本**: `dark:text-slate-500`
- **边框**: `dark:border-slate-800` (替代亮色模式的硬阴影，暗黑模式下主要靠**边框**和**背景色阶**来区分层级)

### 7.3 色彩适应 (Color Adaptation)
暗色模式下的彩色需要稍微“提亮”以保证对比度，同时配合更深邃的柔和背景。
- **主色 (Primary)**: 保持 `dark:bg-blue-600`，或微调至更亮的 `dark:bg-blue-500` 增强视认性。
- **柔和主色 (Soft Primary)**: `dark:bg-blue-900/40` 配合 `dark:text-blue-400` (保持浅柔态的亲切感)。
- **语义色彩**: 均调整为高亮文字+极暗透明背景组合。例如成功状态：`dark:text-emerald-400 dark:bg-emerald-950/50`。

### 7.4 阴影策略 (Dark Shadows)
- **丢弃弥散阴影**: 在 `bg-slate-950` 上，传统的阴影会显得浑浊。
- **发光描边替代**: 对于弹窗 (Modals) 和浮层 (Popovers)，采用 `dark:shadow-none dark:border dark:border-slate-700 dark:bg-slate-900` 的组合，利用微弱的亮色边框勾勒出界面的轮廓（Rim Light 效果）。