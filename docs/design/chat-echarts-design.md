# 聊天内交互图表技术方案

状态：设计建议，尚未实现。日期：2026-10-17。

## 1. 能力定义与范围

根据两张参考图，目标是在助手回复里直接显示交互图表，同时提供源码、复制、放大预览与图片导出。第一期覆盖折线图、柱状图、饼图和散点图，以及多序列、双纵轴、图例切换和 tooltip。图表前后的解释、表格与来源继续使用普通 Markdown。

推荐采用“Markdown 专用代码块 + 受约束 JSON 协议 + ECharts 客户端渲染”。这属于消息展示能力：模型负责生成声明式配置，宿主负责校验、主题、布局与交互。不执行模型生成的 JavaScript。

行情获取、实时订阅、任意 HTML/React 应用、可视化编辑器、大数据附件、服务端图片渲染不进入第一期。截图里的价格与日期仅用于理解交互，不作为数据真实性证据。

## 2. 当前代码基础

- `web/src/features/chat/markdown/markdown-view.tsx` 已将聊天 Markdown 入口指向 `ChatMarkdownRenderer`。
- `web/src/features/chat/rendering/markdown/chat-markdown-renderer.tsx` 的 `ChatPre` 已提取代码块语言、正文，以及 Streamdown 的 `useIsCodeFenceIncomplete()` 状态。
- 同目录的 `chat-code-block.tsx` 已支持 Mermaid 识别、懒加载、源码复制、放大和 PNG 导出，并接入 `useInlinePreviewLease`。
- `web/src/features/chat/rendering/render-cache.ts` 缓存的是生成的安全 markup，不能直接用于缓存 ECharts 活实例。
- 通用 `web/src/components/markdown/markdown-view.tsx` 另有渲染链路，不能假定扩展聊天入口就覆盖笔记、分享和所有 Markdown 页面。
- 当前 `web/package.json` 未声明 ECharts。

本次检查没有可调用的 codebase-memory 图工具，因此以文件搜索和源码阅读为依据。已有未提交的聊天体验及提示词修改，不在本方案中覆盖。

## 3. 数据协议

使用明确的 `echarts` 围栏，不自动把 `json`、`javascript` 或无标签代码识别为图表，避免误渲染用户讨论的配置示例。

````markdown
```echarts
{
  "version": 1,
  "summary": "两组不同币种的收盘价示例，不构成换汇后的收益比较。",
  "option": {
    "title": { "text": "收盘价走势（示例数据）" },
    "legend": { "data": ["港股（HKD）", "美股（USD）"] },
    "xAxis": { "type": "category", "data": ["10-12", "10-13", "10-14"] },
    "yAxis": [
      { "type": "value", "name": "港币" },
      { "type": "value", "name": "美元" }
    ],
    "series": [
      { "name": "港股（HKD）", "type": "line", "yAxisIndex": 0, "data": [108.2, 107.2, 110.5] },
      { "name": "美股（USD）", "type": "line", "yAxisIndex": 1, "data": [110.78, 110.85, 111.17] }
    ]
  }
}
```
````

`version` 固定为 1；`summary` 必填，用作无障碍说明与不支持图表的客户端的文字解释。`option` 是由运行时 schema 定义的 ECharts 子集，不接受任意 `EChartsOption`。后续不兼容变更通过新版本区分；未知版本回退源码。

截图中的未加引号键名和单引号属于 JavaScript 对象字面量，并非严格 JSON。第一期要求模型输出严格 JSON，使用 `JSON.parse`；解析失败保留源码与明确错误，不使用 `eval`、`new Function`，不静默修改数据。如后续确有外部格式兼容需求，可单独评估 JSON5，但其结果仍必须经过相同 schema。

## 4. 渲染与流式链路

```text
Agent 输出 Markdown（echarts JSON 围栏）
  → 现有文本流 / realtime / SQLite transcript
  → ChatMarkdownRenderer → ChatPre
  → 按 language 分发 ChatChartBlock
  → 围栏完成检查 → 大小检查 → JSON.parse
  → 版本与 schema 校验 → 宿主编译安全 option
  → 可见性调度 → 懒加载 ECharts → 图表 / 预览 / 导出
```

不新增消息 content 类型、数据库表、WebSocket 事件或 Gateway API。原始 Markdown 是持久化事实来源；历史加载、刷新和分支恢复都从同一文本重新派生图表。既有全量回复复制/导出应保留原围栏，不能从图表 DOM 反推消息。

需要把分发逻辑放在 `ChatPre` 或一个薄代码块路由组件中，图表单独管理 hooks 和生命周期，避免给现有 `ChatCodeBlock` 叠加另一套实例状态。

流式状态建议：

| 状态 | 展示和行为 |
| --- | --- |
| 围栏尚未完成 | 固定高度骨架和“正在生成图表”，允许切换查看当前源码；不解析半截 JSON |
| 围栏完成、依赖加载中 | 保留同高度骨架，校验通过后加载引擎 |
| 等待可见性调度 | 保留占位，不创建实例；进入可见区或手动预览时激活 |
| 校验成功 | 默认显示图表，提供源码切换 |
| JSON/schema/版本不支持 | 原样展示源码与可理解的原因 |
| 渲染失败 | 回退源码，支持手动重试 |

闭合围栏后即可渲染，即使整段回答仍在生成。以真实围栏状态判断完成，不能把 Markdown 自动补全产生的闭合符视为完成。生成中断且围栏没有闭合时，保留源码并标记未完成；只有明确结束的完整合法载荷才可按既定完成策略渲染。

正文继续流式追加时，不重复解析或初始化已完成图表。以稳定消息 part / block 身份绑定组件，内容摘要与协议/编译器版本作为解析缓存键；相同内容在两条消息中仍需独立实例。

## 5. 安全与 option 编译

模型和工具返回值均作为不可信输入处理。不能仅依赖 Markdown HTML sanitize：图表配置会进入另一套 API。

建议建立严格的运行时 schema，并从校验结果重新构造 option，避免将原对象透传或深合并进宿主默认配置：

- 仅支持已注册的 `line`、`bar`、`pie`、`scatter`；支持有限的 title、legend、坐标轴、grid、series 数据与样式字段。
- 字段白名单是递归的；限制数组、字符串长度、嵌套深度、轴索引和数据类型，拒绝未知/危险字段。报错带字段路径。
- 首期只允许有限的 CSS 颜色形式及预定义符号；禁止外部图片、纹理、`image://`、URL 与数据引用，禁止任何自动网络请求。
- 不开放 formatter 回调、custom series/renderItem、graphic、dataset transform、链接跳转、HTML dataView、extraCssText 或模型配置的 toolbox。
- tooltip 由宿主构造，固定使用 `renderMode: 'richText'`；export 按钮由宿主实现。
- 禁止 `__proto__`、`constructor`、`prototype` 等危险键；禁止通过函数源码字符串恢复回调。
- 数据缺失显式使用 `null`；拒绝不合法数字，不把缺失点转换为 0，不排序或补造日期。

建议初始上限：每块 100 KiB、20 个序列、合计 10,000 个数据点、嵌套深度 16、标题 200 字符。这些是待性能测试校准的产品限制，不是 ECharts 自带保证。超限时保留源码，提示减少数据量；第一期不自动采样改变结果。

ECharts 官方明确列出 HTML tooltip、链接、CSS 与 transform 正则等输入风险，且不替调用方全面清洗不可信配置：[安全指南](https://echarts.apache.org/handbook/en/best-practices/security/)。限制 JSON 语法本身不能替代字段白名单。

## 6. 交互、主题与资源管理

- 顶部统一操作：“图表 / 源码”、复制配置、放大、下载 PNG。复制配置指复制原始 JSON；整条消息复制保留 Markdown。
- 默认高度建议桌面 360px、窄屏 280px；使用父容器实际宽度，避免硬编码图宽。宿主负责网格留白、长标签处理与图例布局。
- 通过 `ResizeObserver` 监听容器，在尺寸可用后 init；在对话侧栏变化、预览打开或容器恢复可见时 resize。
- 颜色、背景、文字、分割线由现有语义 token 映射到 ECharts option；模型只表达可允许的业务配色。主题切换重新编译样式，不清空原始数据。
- 默认关闭首次动画，尊重减少动态效果设置，避免滚动回历史时重复播放。
- 放大弹窗固定响应式外框，内部图表占据可用空间，遵守项目 modal sizing 规范。用同一 validated spec 创建独立预览实例，不搬运原 DOM。
- 动态 import `echarts/core`，仅注册支持的系列、组件和 Canvas renderer；不用 CDN。官方支持按模块导入：[导入指南](https://echarts.apache.org/handbook/en/basics/import/)。
- 复用现有 inline preview 调度入口前先确认它的容量和撤销语义；图表需要在租约撤销、卸载与虚拟列表回收时 dispose，并断开 observer 和事件监听。新加图表不能导致 Mermaid 长期无法获调度。
- 缓存校验/编译结果可用有界 LRU；不把 ECharts 实例、Canvas 或 DOM 放进全局 markup cache。
- PNG 使用活实例导出，由宿主清理下载文件名。导出失败只影响本次操作，不覆盖已成功的图表。第一期不提供 SVG 下载，避免混用现有 Mermaid 的 SVG 导出实现。
- `summary` 提供可读描述；提供按轴、系列与数据点展开的数据表入口，支持键盘操作和触屏 tooltip。

## 7. Agent 与客户端能力

在现有 prompt 构建链中新增独立的图表展示说明，不把大量协议内容直接堆进已有 behavior section。说明包含围栏标签、严格 JSON 示例、类型范围、单位、缺失值约定及禁止函数/外部资源的要求。

最好通过实际客户端展示能力决定是否注入该说明；首期若尚无可靠客户端能力信号，就只在已知支持的 Web 回复路径启用，并保留文字解释。不能假定 channel 名称必然等于当前查看客户端。

Web / 使用该 Web UI 的 Electron 窗口可共享渲染能力。Telegram、CLI 及未适配的原生客户端继续提供文字/表格或配置源码；共享协议不等于原生客户端自动获得图表渲染。将来需要图片渠道输出时，另做服务端渲染与媒体发送能力。

所有真实分析结果必须带来源与时间区间；这可放在图表相邻 Markdown，不必第一期引入复杂引用字段。不同市场交易日必须按实际日期对齐，不能按数组位置当作同一天；不同币种标清轴，跨币种收益比较需单独归一化。图表校验只保证结构合法，不证明行情真实。缺少可靠数据时提供明确标记的示例或先获取数据。

## 8. 建议文件与职责

以下为建议新增文件，最终命名遵循对应目录约定：

| 文件 | 职责 |
| --- | --- |
| `web/src/components/charts/chart-spec.ts` | v1 schema、限制、错误类型和纯解析函数 |
| `web/src/components/charts/chart-option.ts` | 从校验数据与主题构造安全 option |
| `web/src/components/charts/echarts-runtime.ts` | 按需注册与懒加载引擎 |
| `web/src/components/charts/echarts-view.tsx` | init/setOption/resize/dispose、无障碍描述 |
| `web/src/components/charts/chart-preview-dialog.tsx` | 固定外框预览、独立实例和导出 |
| `web/src/features/chat/rendering/markdown/chat-chart-block.tsx` | 流式状态、源码切换、错误回退和调度 |
| `web/src/features/chat/rendering/markdown/chat-markdown-renderer.tsx` | `echarts` 围栏分发 |
| `src/agent/prompt/sections/chart-presentation.ts` | 图表协议及生成约束 |
| `web/src/i18n/locales/{zh,en}/chat.json` | 状态、操作与错误文案 |
| `web/package.json`、`pnpm-lock.yaml` | 引擎依赖，由 pnpm 管理 |

schema、option 编译与实例容器相互分离，方便后续通用 Markdown 或其他客户端复用协议。第一期不把所有特殊代码块重构成大型插件框架；保留清晰分发点即可。

## 9. 实施顺序与验收

1. 固定协议、类型白名单及纯解析/编译函数，先用静态消息 fixture 验证截图中的多序列双轴场景。
2. 接入聊天围栏与流式状态，完成默认图表、源码切换、错误回退和历史恢复。
3. 接入可见性调度、主题、resize、预览、PNG、键盘和触屏行为。
4. 接入 Agent 提示与客户端能力判定，验证真实生成结果；再评估分享、笔记与原生端的独立适配。

必须覆盖的测试：

- 单元：协议版本、JSON 错误、白名单、危险键、URL/图片、超限、双轴索引、null 数据及源对象不被修改。
- 流式：在任意 chunk 边界拆分围栏和 JSON；围栏未完成时不调用引擎；完成后初始化一次；后续正文追加不重建；中断/重试可回退。
- 生命周期：尺寸为 0、恢复可见、主题变更、卸载、租约撤销、异步加载完成前卸载、预览开关及重试不泄漏实例。
- 浏览器：真实 ECharts 的 tooltip、图例、双轴、暗色、窄屏、弹窗、PNG；不能只靠 mock 引擎断言。
- 回归：普通代码、Mermaid、数学公式、长消息虚拟滚动、消息复制与刷新恢复；多图消息不会显著阻塞正文输入和滚动。

按项目脚本运行相关 Vitest、web type-check、lint 和构建。首期发布前记录首图依赖加载体积、校验与渲染耗时、多图滚动和内存回收情况，据此调整限制。

## 10. 后续演进

大数据可增加受授权的本地附件引用与分页/采样；跨渠道图片可增加隔离的服务端图片任务。ECharts 支持 SVG SSR，但会新增服务端资源控制、权限与缓存问题，不建议为了聊天首期图表就引入：[服务端渲染指南](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/)。

如果后续要支持任意交互应用，应另设 sandbox artifact 协议与权限边界；不要逐步放开本图表协议中的 JavaScript 执行。
