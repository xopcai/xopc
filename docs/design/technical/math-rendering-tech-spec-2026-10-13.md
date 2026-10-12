# xopc 公式渲染技术方案

日期：2026-10-13。状态：Web、通用 Markdown、笔记、扩展及三端本地渲染已实现；模拟器核心验证通过，发布验收边界见第 12 节。

## 1. 实施决策

采用 KaTeX 作为默认数学排版引擎，保留现有 Markdown 渲染架构。建立统一的公式语法契约、受控排版模块和跨端样例集，分别适配 Streamdown、Marked、markdown-it 和移动端。原始 Markdown 继续作为存储、复制整条消息和导出的权威内容。

首个交付覆盖 Web 聊天与历史消息；第二个交付覆盖通用 Markdown、笔记编辑往返和浏览器扩展；移动端作为独立验收阶段。阶段完成时明确声明覆盖范围，Web 完成不等于全产品完成。

首期不加载 MathJax，不实现双引擎自动重试，不新增服务端公式渲染 API。未来只有实际语料证明需要自动断行或更强无障碍能力时才增加第二个引擎。

## 2. 实施前基线与问题证据

| 链路 | 当前入口 | 缺口 |
| --- | --- | --- |
| Web 聊天 | `web/src/features/chat/rendering/markdown/chat-markdown-renderer.tsx` | Streamdown 2.7.0，只注册 CJK 插件；分块、净化、逐字动画均需接入公式语义 |
| 通用 Markdown | `web/src/components/markdown/parse-markdown.ts`、`markdown-view.tsx` | Marked 无数学 tokenizer；DOMPurify 禁止 style 且仅允许 HTML profile |
| 笔记预览 | `web/src/features/notes/note-markdown-view.tsx` | 复用通用渲染器 |
| 笔记编辑 | `web/src/components/block-editor/block-editor.tsx`、`packages/note-editor-core/src/index.ts` | Tiptap + tiptap-markdown，需增加数学节点与序列化规则 |
| 浏览器侧栏 | `packages/browser-ext/src/sidepanel/markdown-content.tsx` | markdown-it 无数学规则 |
| Android | `apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/MarkdownContent.kt` | commonmark-java + Compose，需数学 AST 与呈现组件 |
| iOS | `apps/mobile-ios/XopcMobile/Core/Models/MarkdownBlocks.swift`、`Features/Assistant/MarkdownBodyView.swift` | 自有 MarkdownBlock 与 SwiftUI，需数学 block/span |
| 鸿蒙 | `apps/mobile-harmony/entry/src/main/ets/common/markdown.ets` | 自有 block/span，需保留数学原文并接入公式呈现 |

已做的最小复现：

1. 使用本仓库安装的 Marked 和未启用数学插件的 Streamdown 渲染 `\[\mathcal{R}_{syn}(s_T;g)\triangleq\mathbb{I}\big[V_g(s_T)=\mathrm{True}\big]\]`，两者都输出普通段落，外层 `\[` / `\]` 变为 `[` / `]`，与截图症状一致。截图对应会话的真实存储内容未读取，因而这是同类问题复现。
2. 使用现有 `parseMarkdownIntoBlocks` 处理内部带空行的 `aligned` 公式，公式被拆成两块。
3. `createRevealPlugin` 跳过 MathML/SVG，却没有跳过 KaTeX HTML 的 `katex` 子树；`rehypeChatFileMentions` 也需要跳过公式树。
4. 检查安装的 Streamdown 2.7.0 实现，`plugins.math.rehypePlugin` 追加在用户传入的 rehype 插件之后。可保留“先净化内容，再生成公式”的顺序。该行为需要集成测试锁定，不能只依赖在线最新文档。

初始调研阶段未测量性能和设备表现；实施后的浏览器与模拟器结果见第 12 节。

## 3. 公式语法契约

所有接入端使用 dialect `xopc-math-v1`。明确边界才进入排版；不猜测普通方括号中的 LaTeX，不修改历史存储，不给未闭合输入写入虚构的结束符。

| 输入 | 行为 |
| --- | --- |
| `\(x^2\)` | 行内公式；边界内部不得跨逻辑行 |
| `$x^2$` | 保守识别行内公式，规则见下文 |
| 独立逻辑行的 `\[E=mc^2\]` | 块级公式，支持边界与表达式处于同一行 |
| 独立逻辑行的 `$$E=mc^2$$` | 块级公式 |
| `\[` 或 `$$` 开头的多行块 | 支持矩阵、`aligned`、`cases` 及公式内部空行 |
| 显式 fenced code，语言为 `math` | 作为块级公式；其他语言保持代码 |
| 正文中 `before $$x$$ after` 或 `before \[x\] after` | 首期保留普通文本；避免块元素嵌入段落，模型输出约定使用独立行 |
| 普通 `[x]`、无边界的 `\frac{1}{2}`、独立 `\begin{...}` | 保持原文 |
| 反引号代码、其他 fenced code、缩进代码、图片 alt、链接目标、HTML 源码 | 不识别公式；链接可见文字中的行内公式可识别 |

独立逻辑行指移除合法列表/引用容器前缀后的内容。支持列表项和引用中的公式块，容器前缀由宿主 Markdown parser 处理，不由全局字符串替换处理。只有表格单元格中的行内公式属于首期范围；块级公式不进入表格单元格。

单美元规则：开符后和闭符前不得为空白；不得跨行；闭符后不得紧跟数字；纯金额形态（仅数字、分组符号、小数点及货币符号）保留文本。`$x$`、`$\alpha$` 进入排版，`价格 $5，运费 $10`、`$100$` 保留文本，数字公式使用 `\(100\)`。规则是产品约定，无法消除全部自然语言歧义；更明确的 `\(...\)` 始终优先推荐。

识别边界时计算连续反斜杠的奇偶；例如源文中的 `\\(` 不是行内公式开始。公式内容保持反斜杠、花括号、百分号与下划线原样。结束符识别需遵循 TeX 注释：未转义 `%` 后到行尾的内容不参与闭符匹配。首期不支持跨公式的宏定义和 catcode 修改。

不使用全局正则把 `\[` 替换成 `$$`，也不在已经解析好的 text 节点中搜索原始边界；这两种方式都会混淆代码、转义和已经丢失的信息。

## 4. 模块与接口

### 4.1 共享模块

新增私有 workspace 包 `packages/markdown-math`，包名 `@xopcai/markdown-math`。按 exports 子路径隔离依赖：

```text
packages/markdown-math/
  src/
    syntax.ts              语法判定、边界扫描、状态与限制
    types.ts               MathSource、MathRenderResult
    policy.ts              dialect 与排版配置
    render.ts              KaTeX 调用、错误转换、有限缓存
    remark.ts              micromark 语法扩展与 mdast 构建
    rehype.ts              已净化数学节点 → KaTeX HAST
    marked.ts              block/inline tokenizer；输出源码占位节点
    markdownIt.ts          block/inline 规则；受控 HTML renderer
  fixtures/
    dialect-v1.json        所有端共用的输入与期望
  __tests__/
```

`/syntax`、`/policy` 不引入 React、DOM、KaTeX、Node 内置模块或 Markdown parser。其他子路径只导入自己的引擎/parser。不建立会把所有 adapter 打进浏览器扩展的总入口。

```ts
type MathDelimiter = 'paren' | 'dollar' | 'bracket' | 'double-dollar' | 'math-fence';

interface MathSource {
  raw: string;
  latex: string;
  display: boolean;
  delimiter: MathDelimiter;
  state: 'pending' | 'complete';
  range: { start: number; end: number }; // Half-open UTF-16 offsets in original source.
}

type MathRenderResult =
  | { status: 'ready'; html: string }
  | { status: 'pending' }
  | { status: 'fallback'; reason: 'invalid' | 'unsupported' | 'limit'; source: string };

interface MathRenderContext {
  streaming: boolean;
  policyVersion: 'xopc-math-v1';
}
```

源码范围用于分块和编辑，不作为跨版本持久 ID。输入换行符只在 parser 工作视图规范化，范围通过映射回到原始源码；原始 `raw` 不被规范化。原生端使用自己的字符串索引，但 fixture 统一定义 UTF-16 偏移。

共享扫描函数在宿主 parser 已确认的上下文中判断公式，例如 `readInlineMathAt(source, offset)` 和 `readDisplayMathAt(source, offset, context)`。共享模块不是第二套完整 Markdown parser。remark 通过 micromark syntax extension 在反斜杠转义前生成数学节点；Marked、markdown-it 在各自的 tokenization 阶段调用同一语法规则。

采用自定义 Streamdown MathPlugin（`remarkPlugin = remarkXopcMath`、`rehypePlugin = rehypeXopcMath`）而非直接启用默认 `@streamdown/math`。原因是本方案的美元规则、反斜杠边界及 pending 状态与默认插件不同。沿用其插件接口，不同时注册默认数学插件或 remark-math，以免两套语法重复解析。

语法节点的 pending 表示源码未闭合；`renderMath(source, context)` 结合 streaming 决定显示 pending 还是终态 fallback。Streamdown processor 缓存按插件名称和 JSON options 生成键，因此渲染上下文通过不可变插件 tuple options 传递，例如 `[rehypeXopcMath, { streaming, policyVersion: 'xopc-math-v1' }]`；不以相同名称的闭包捕获会话 source、回调或可变 streaming。终态切换更新 options 与插件列表引用，确保 memo 与 processor 缓存不会沿用旧上下文。

### 4.2 KaTeX 配置

统一配置如下；数值为首版工程预算，需通过语料和设备基准确认：

```ts
{
  output: 'htmlAndMathml',
  trust: false,
  throwOnError: true,
  strict: 'ignore',
  maxExpand: 1000,
  maxSize: 20,
  globalGroup: false,
  macros: {},
  displayMode: source.display,
}
```

每次排版创建新的 macros 对象；不允许 A 消息或 A 公式的 `\gdef` 改变 B 公式。`strict: 'ignore'` 用于避免中文混排警告刷屏，并不放宽 trust。捕获解析异常后返回显式 fallback，不把 KaTeX 错误文本插入 HTML，不自动删除命令或改变公式含义。无法可靠区分 invalid/unsupported 时统一标记 invalid。

首次实施根据可用的正式 release 与依赖兼容性锁定 KaTeX 版本，并统一 JS、CSS 和字体资源版本；不照抄文档中的旧 CDN 版本。CSS 和字体随 Web、Electron、扩展与移动资源包本地构建，运行时无 CDN 请求。

单公式 LaTeX 上限 16,384 个 UTF-16 code units；单消息最多排版 256 个公式，超过预算的公式保留源码，不丢弃其后的正文。渲染缓存按 `engineVersion + policyVersion + display + latex` 精确键控，采用 LRU，最多 256 项和 2 MiB 的估算字符串内存，先到上限先淘汰。缓存 ready/fallback，不缓存持续变化的 pending 源文。

长度、尺寸和宏展开限制不是严格的运行时间隔离。首期做主线程预算测试；如果合理限制内的表达式仍产生长任务，再把 render 迁移到 Worker，不能用 `setTimeout` 声称已中止同步解析。

## 5. Web 聊天与流式处理

### 5.1 解析、净化和排版

```mermaid
flowchart LR
    A[原始消息 Markdown] --> B[识别数学 token 与源文范围]
    B --> C[保持数学区域完整的聊天分块]
    C --> D[Streamdown Block 与 remarkXopcMath]
    D --> E[现有链接处理与 rehypeSanitize]
    E --> F[rehypeXopcMath 受控 KaTeX 排版]
    F --> G[跳过公式的逐字动画]
    G --> H[React 呈现与复制]
```

数学 mdast 节点通过明确 handler 输出 `<code class="math-inline">` 或 `<pre><code class="math-display">`，保留源码、边界类别和 complete/pending 状态。内部状态属性只由语法节点构建，先前的原始 HTML 仍由 `remarkChatContent` 转为文本。对 fenced `math` 采用同一路径；HTML 里的伪造 class 不获得生成权限。

在现有 code class 白名单中增加 `math-inline` / `math-display`，并仅为数学 code 节点增加所需状态属性。数学引擎在 sanitizer 之后替换这些节点，输出受控 HAST。普通 Markdown 不获得 style、SVG、MathML 的全局权限。`rehypeChatFileMentions`、`rehypeChatFragments` 在数学渲染前执行；任何渲染后的文本装饰也必须跳过数学包装节点。

`createRevealPlugin` 额外跳过带 `data-xopc-math` 的整体包装，以及 `katex` / `katex-display` 子树。公式按整体出现，内部不插入动画 span。ready/fallback 节点均保留稳定的源文身份；MathML 的可访问性输出不进入逐字长度计算。

### 5.2 分块与不完整 Markdown 修复

新增 `parseChatMarkdownBlocks`，返回原始源码切片与数学区域元数据。扫描复用数学语法扩展得到的 token/source ranges；列表、引用、fence 与缩进代码上下文必须由 parser 识别，不能只数方括号。

在非数学文本上保留现有分块行为与 wholeDocument 分支；公式范围内部禁止分块，包括内部空行。开了块级公式但未收到闭符时，该容器内的剩余尾部暂属于 pending 公式；到容器结束或预算上限终止，不吞并其他容器。收到 closed 后再固定后续块。未闭合的行内单美元暂保留文本，避免金额让整段正文停住；明确的 `\(` 可呈现 pending。

原始源码与 Streamdown/Remend 修复后的字符串分开。第一版对含数学节点或 pending 数学边界的 Block 设置 `shouldParseIncompleteMarkdown=false`，其他 Block 沿用现有修复逻辑。这样不让 Remend 合成闭符或改写公式内部的 `_`、`*`、反引号。接受该 Block 中其他未闭合强调暂时按普通文本展示的取舍；公式正确性优先。后续若要恢复这类文本修复，须通过完整测试的数学区域保护机制实现，不能简单分段调用 Remend。

分块元数据按 message/content-part 缓存。追加输入只重解析最后一个未稳定的容器及 tail；重写输入或 wholeDocument 分支执行完整解析。不得为每个 token 重解析所有历史稳定块；同时在基准中计入 tokenizer 和分块耗时，避免只优化 KaTeX 而引入另一处全量扫描。

初始加载、流式追加与流式结束使用同一语法与同一 DOM 树。终态事件显式传递 `streaming=false`，重算 pending → fallback，不通过重新挂载整条消息完成切换。Block key 沿用追加时稳定的顺序身份，不按全文 hash 重建。

### 5.3 状态机

| 状态 | 呈现 | 转移 |
| --- | --- | --- |
| 无公式边界 | 普通 Markdown | 确认明确边界后进入 pending |
| pending | 中性源文预览，块级标记“公式生成中”；不执行 KaTeX | 闭符 → render；完成/停止/超限 → fallback |
| complete + ready | KaTeX HTML + MathML | 源文变化才重新排版 |
| complete + fallback | 可选择、可复制的完整源文与简短提示 | 源文被编辑后重新尝试 |

部分消息重放、修订和 abort 均用当前权威 source 重新计算状态；内存中的 pending 状态不写入数据库。

## 6. 通用 Markdown、笔记与扩展

### 6.1 Marked / DOMPurify

数学 tokenizer 输出源码占位元素，不在 `parseMarkdown` 阶段生成 KaTeX HTML。`MarkdownView` 先沿用 `sanitizeMarkdownHtml`，再执行 `mountMathNodes`，由受控渲染器把识别的占位节点替换为公式；生命周期沿用 Mermaid 的取消/卸载模式，但不使用 Mermaid 的 SVG sanitizer。

占位元素包含安全转义的 source 和固定数学标记。`mountMathNodes` 检查该标记及源文契约，明确 math fence 也允许进入渲染；源码 HTML 已被 escape，不能构造有效占位元素。排版内容不会再经过禁止 style 的普通 Markdown sanitizer。公式挂载先于代码复制头部和 Mermaid 探测，避免数学占位被识别成普通代码块。

通用 Markdown 的 `streaming` 参数为可选、默认 false；只有确实呈现动态文本的调用点传 true。终态无闭符保持源码，永不“修复”持久内容。

### 6.2 笔记编辑往返

新增 Tiptap `InlineMath` 与 `BlockMath` 节点，并使用 markdown-it adapter 的 placeholder 模式为 tiptap-markdown 提供解析规则。节点属性包含 latex、delimiter、原始 raw；内容通过数学节点承载，不经普通文本的反斜杠转义。

未编辑数学节点时序列化使用保留的 raw；用户编辑公式后按节点原边界形式重新生成源码。公式块中的列表/引用缩进由外层 Markdown serializer 负责。整个笔记仍允许现有 serializer 的格式规范化，但公式语义及节点原文不得因打开、编辑其他段落、保存而损坏。

节点预览使用同一渲染模块；点击进入 LaTeX 源码编辑，取消保留原节点，确认时无效公式也允许保存为源码。不引入公式可视化编辑器依赖。复制整篇笔记仍输出 Markdown。

必须验证 paste、undo/redo、编辑无关段落、保存和重新载入，以及未知命令/未闭合公式。编辑器不认识的公式片段不得被预览渲染覆盖后序列化为空。

### 6.3 浏览器扩展

在现有 `MarkdownIt({ html: false })` 上注册 math block/inline rules。识别发生在 escape 之前；排版输出仅来自受控 render 模块，fallback 一律 HTML escape。保留 `html: false`，不增加对任意用户 HTML 的支持。

增加与 Web 相同的 streaming 状态和样例；CSS/font 打包到扩展内部，符合现有 CSP。字体 URL 必须在最终扩展构建内可解析，不依赖开发服务器路径。

## 7. 移动端方案与验证门槛

Android、iOS、鸿蒙先新增数学 AST 节点与 source 保留，按统一 fixture 验证语法。Kotlin/Swift 不直接运行 TypeScript，共享契约与 JSON fixture；鸿蒙使用同一规则的 ArkTS 实现，不能假定通用 TS scanner 可直接通过 ArkTS 编译。

块级公式使用本地资源 Web 容器 + KaTeX，三个平台使用同一引擎、CSS 与字体包。实施时容器接受结构化 `{ revision, markdown, streaming, dark, fontSize, color? }`，通过平台结构化桥接或 JSON 安全编码传值，不插入未编码的源文。输出高度用 ResizeObserver 在字体加载后报告；宿主只接受当前 revision 的测量值并限制高度。禁用导航与网络内容，不传入 gateway token。

原生外层承载“复制公式源码”，保留公式边界；本地页面承担含公式段落的 Markdown 和数学排版，错误表达式在原位置保留源码。避免每个 token 重建 Web 容器，复用可见消息内的实例并释放离屏实例。具体容器数量上限由设备测试决定。

实施时含行内公式的整个段落交给共享本地 Markdown host，避免把 Web 公式嵌入原生文字造成基线错位；其他段落和媒体继续走原生组件。换行、选择复制和读屏协作仍需发布验收。如果无法满足验收，可评估 iosMath / AndroidMath 或原生绘制方案，但使用单独能力矩阵；不自动改为另一个引擎后声称完全一致。鸿蒙须独立验证相同语法样例。

移动端已完成本地容器实施与核心模拟器验证。正式发布前还需满足：离线渲染通过；混合文本基线可接受；50 条含公式消息滚动没有明显回收抖动；主题/字体变化不出现错误高度；流式停止后终态稳定；VoiceOver/TalkBack/鸿蒙读屏不重复朗读视觉层。未验收项见第 12.3 节，不能以模拟器核心用例代替真机发布验收。

## 8. 布局、复制与无障碍

使用现有 semantic tokens 和 `markdown.css`，不建立新色板。公式默认继承正文颜色和用户字体缩放。块级包装 `max-width:100%`、`min-width:0`，长公式局部横向滚动，不撑宽消息、不缩小整条消息字体；保留 `aligned` / `cases` 的显式排版。

块级公式提供“复制 LaTeX”，复制表达式而非排版 DOM，并可通过菜单复制含边界的 Markdown。行内公式通过消息菜单提供同等能力，避免每个符号旁新增按钮。整条消息复制维持原始 Markdown。

保留 KaTeX MathML 与隐藏视觉层的可访问性语义；pending/fallback 使用普通可读源文，不逐 token 触发 live region。验证通用 Markdown 的 DOM 挂载与 React 路径具有相同读屏结果。公式复制动作使用现有剪贴板反馈与 i18n 文案。

首期不承诺公式 PNG/SVG 导出、自动编号、跨公式引用、宏共享或公式语音生成。

## 9. 文件改动与交付顺序

| 阶段 | 主要改动 | 完成条件 |
| --- | --- | --- |
| A：共享契约与 Web 聊天 | 新 `packages/markdown-math`；chat renderer、math-aware splitter、reveal、plugins、markdown CSS、Web 依赖与 lockfile | 截图原式 + dialect + 流式/终态 + 净化安全 + 浏览器布局通过 |
| B：通用内容与笔记 | Marked adapter、`markdown-view` 挂载、Tiptap math nodes、note-editor-core 序列化 | 预览一致、笔记公式往返无损、现有 Mermaid/链接/代码复制通过 |
| C：浏览器扩展 | markdown-it adapter、侧栏 streaming、样式/font/CSP 打包 | 离线实际扩展渲染与 Web 样例一致 |
| D：移动验证与实现 | 三端 AST、资源包构建、本地公式视图、revision 测量桥接 | 设备门槛通过后实现并完成跨端验收 |

每一阶段可单独审阅，不提前增加数据库字段、网关路由、Agent 模型输出改写或配置迁移。模型提示后续可推荐行内 `\(...\)`、块级 `\[...\]`，但不是识别正确性的前置条件。

服务端 `src/markdown/ir.ts` 与 Telegram/Weixin 等渠道的发送格式不随前端方案改成 HTML；本期保留可读源码。渠道公式图片发送、PDF 导出属于后续明确需求，不影响本期前端验收。

## 10. 验证计划

### 10.1 契约与回归

建立至少以下 fixture，每例包含源码、节点模式、LaTeX、范围、终态与是否预期降级：

- 截图公式；行内上下标、分数、积分、求和、矩阵、cases、aligned、tag、中文 `\text`。
- 所有边界形式、同一行独立 display、内部空行、列表/引用、CRLF、Unicode 与 emoji 偏移。
- 金额、转义美元、纯数字美元、反斜杠奇偶、代码与 Mermaid、图片/链接目标、伪造 HTML 标记。
- 公式内 `_`、`*`、反引号、百分号注释、花括号，以及未支持命令、宏循环与超限。
- 表格 inline 公式、外部 Markdown 强调包含 inline 公式；无边界 LaTeX 保持文本。

对核心公式样例在每一个源码偏移位置切开，输入第一段并标记 streaming，追加第二段再结束：不得因补出的闭符提前呈现 ready；最终源码、公式类型和排版结果与一次性完整输入一致。另外测试单字符追加、较大批次追加、断流、abort、非追加修订和页面重开。

集成测试验证 sanitize 前后顺序、公式树不被动画/文件链接处理改写，以及代码复制和 Mermaid 不回归。未闭合状态不产生 KaTeX 调用；已完成公式在尾部更新时不重复排版；同步渲染异常被局部降级，不崩掉整条消息。

### 10.2 浏览器与性能

真实浏览器验证 320/375/768/1440 CSS px 宽度、明暗主题和 100%/150%/200% 缩放；检查分数线、字体、裁切、横向滚动、复制和 MathML。离线重新打开带公式历史消息，不出现 CDN 请求。

记录无公式对照、50 条含公式消息、单消息 100 个公式及持续流式 tail：额外 JS/CSS/font 的 gzip 大小、冷启动耗时、单公式排版 p50/p95、稳定块重复排版次数、长任务与缓存增长。初始目标：约定测试设备上常见公式热排版 p95 ≤ 16 ms，连续 tail 更新不重新排版稳定公式，没有持续增长的缓存。目标是待验证预算，不是当前结果；出现 ≥ 50 ms 长任务时定位并决定 Worker/分批调度。

测试根项目 `packages` 与 `web` Vitest project 下的新增及受影响用例，运行共享包 typecheck、Web type-check/build；扩展运行自己的 typecheck/build 与构建校验。移动阶段按平台现有测试流程实施。文档阶段不运行全量构建作为公式能力完成的证据。

### 10.3 发布与回退

每阶段通过验收后随正常前端/客户端发布，无数据迁移。版本回退会使公式重新显示源码，原始消息和笔记仍可读取。发布前记录 fixture 版本、KaTeX 版本、字体资源版本与覆盖端。

不新增后端日志输出公式全文。开发诊断只记录渲染耗时、长度、数量、状态和错误分类，复用现有 streaming metrics；同一公式失败不在每次流式更新时重复报错。

## 11. 技术依据与待验证项

- [KaTeX options](https://katex.org/docs/options)：HTML + MathML、trust、宏状态、尺寸与展开限制。
- [KaTeX security](https://katex.org/docs/security)：受控生成内容与不可信输入边界。
- [Streamdown math plugin](https://streamdown.ai/docs/plugins/math)：数学插件接口与默认美元语法；本方案使用安装版源码验证的顺序。
- [rehype-katex security](https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex#security)：先净化用户内容，再生成受控排版的原则。
- [micromark extensions](https://github.com/micromark/micromark#extensions)：语法识别必须位于 Markdown escape 之前。
- [Marked extensions](https://marked.js.org/using_pro)：保留现有 parser 并增加 block/inline tokenizer。
- [markdown-it architecture](https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md)：宿主 block/inline 规则的适配位置。
- [MathJax 4 line breaking](https://docs.mathjax.org/en/latest/output/linebreaks.html)：未来长公式自动断行的候选。

实施前的技术验证集中在三个地方：micromark 扩展与 Streamdown Block 的 source/pending 传递；Tiptap math node 的 Markdown 往返；移动本地 Web 容器的行内布局。通过小范围原型验证这些契约，再推进对应阶段，不能以“插件已安装”作为完成标准。

## 12. 实施与验证记录

### 12.1 已交付的代码

- 私有共享包 `packages/markdown-math`：锁定 KaTeX **0.19.0**，统一 JS/CSS/字体，包含 micromark、Marked、markdown-it adapter、受控排版、源码占位、pending/fallback 和有限缓存。
- Web 聊天：数学区域完整分块、先净化再排版、跳过逐字动画和文件路径装饰、256 个公式的消息预算。通用 Markdown 和笔记预览使用先 DOMPurify 后受控挂载。
- 笔记编辑：Tiptap 数学 atom、预览和 LaTeX 源码编辑，序列化保留原始边界；撤销、重做、HTML 粘贴、编辑其他段落和重新载入均有回归测试。
- 浏览器侧栏：共享 markdown-it 语法、流式状态及本地字体打包，保持 `html:false`；整条回复复制仍使用原始 Markdown。
- Android、iOS、鸿蒙：保留数学源码，显示多行/空行公式和显式 math fence；含行内公式的段落使用共享本地 HTML host。字体离线加载，revision 防止旧高度覆盖新内容，链接由宿主处理，释放时清理桥接。
- 构建：Android preBuild、iOS 生成项目和鸿蒙 Hvigor 接入资源生成；CI 与发布构建补齐 pnpm/Node 依赖。资源目录由脚本生成并忽略，不提交生成的 JS 和字体。
- 移动端按整条消息的候选数学边界保守计数，超过 256 时该消息的数学段落均保留源码，避免多个 host 累计突破预算；代码或金额也可能增加候选计数，因此比 Web 按实际数学节点保留前 256 个更保守。

### 12.2 实际通过的验证

| 范围 | 结果 |
| --- | --- |
| 共享模块 + Web 相关回归 | 11 个测试文件、128 项通过；随后新增笔记往返 4 项，数学 Web 集成共 22 项通过 |
| 共享 dialect 样例 | 9 个样例在 markdown-it、Web 聊天、通用 Markdown 中一致；共享包共 26 项通过 |
| Web / 共享包 / 扩展 | TypeScript 检查通过；Web 和扩展正式构建通过，扩展构建校验通过 |
| 真实 Chrome | 320/375/768/1440 CSS px 下页面不溢出，3 个公式均有 HTML + MathML，本地字体加载，零 pageerror；375 px 下明暗主题和 100%/150%/200% zoom 通过 |
| Android API 35 模拟器 | 2 项数学 parser 单测通过；2 项实际 Compose + WebView 测试验证离线字体、ready → pending → ready 和整条消息预算降级，通过 |
| iOS iPhone 17 Pro 模拟器 | 3 项 XCTest 通过，验证容器、TeX 注释、math fence、空行和实际 WKWebView 字体/MathML/pending；新增 Swift 文件严格 lint 零问题 |
| 鸿蒙 API 26 Pura 90 Pro 模拟器 | HAP 构建、安装成功；Hypium 测试验证实际 ArkWeb 字体、ready → pending → ready 和消息预算降级，1 项通过并保存截图 |
| 鸿蒙主机与静态检查 | 114 文件、743 项主机测试通过，随后数学预算等 3 项专项测试通过；相关服务端回归 73 项通过；仓库 TypeScript 检查通过；CodeLinter 零错误、零警告，现有启动图标建议不属于本次改动 |

本机 Chrome 对 100 个不同求和/分数公式的同步样例测量：首次排版 p50 约 0.1 ms、p95 约 0.2 ms、最大约 0.7 ms；缓存命中 p95 低于计时器 0.1 ms 分辨率。100 个公式的数学范围解析约 4.9 ms，重复范围查询约 0.1 ms；缓存 103 项、约 835 KiB。结果仅表示本机短公式样例，不覆盖首屏 DOM、字体加载、复杂表达式或移动设备性能，也不能证明所有输入不会产生长任务。

### 12.3 发布前仍需验收

- 三端本地容器核心功能已经通过模拟器，尚未完成真机上的 50 条含公式历史消息滚动、长期内存和回收抖动测量。
- VoiceOver、TalkBack 和鸿蒙读屏的真实朗读体验仍需人工设备验收；保留 MathML 不等于已经通过读屏验收。
- 移动 parser 以原有原生 Markdown 方言为基础，使用共享 host 排版；完整容器嵌套、选择复制和全部 fixture 的端到端一致性还需扩充设备测试。
- 未发布客户端、未部署网关、未迁移历史数据。模型原始文本仍是权威数据；无法识别或不支持的公式保留源码。

重现入口：根目录 `pnpm vitest run --project packages --project web packages/markdown-math web/src/components/markdown/__tests__ web/src/features/chat/rendering/markdown/__tests__ packages/note-editor-core`；`pnpm run harmony:verify --host-only`；iOS `XopcMobileTests/MathMarkdownTests`；Android `MathMarkdownTest` 与 `MathMarkdownViewTest`；鸿蒙 Hypium class `XopcMathMarkdown`。
