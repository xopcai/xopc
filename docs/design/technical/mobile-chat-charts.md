# 移动端聊天图表实现与验收

日期：2026-10-17。

## 实现范围

Android、iOS、HarmonyOS 的原生 Markdown 都支持 `chart` fenced code block，复用现有 ChartSpec v1。Agent 继续按需加载同一个图表 Skill，输出同一份 JSON，无需识别手机平台或生成 ECharts option。

- 支持折线图、柱状图、多序列、负数、零和 `null`。缺失值保留断点，不插值、不转换为零、不静默抽样。
- 真实闭合围栏出现后才创建绘图组件。反引号/波浪线的字符、长度和结束行均参与判断，流式结束本身不代表围栏闭合。
- 原生操作栏提供复制完整 JSON、源码预览、放大和分享 PNG。源码预览只展示前 4096 个字符，复制入口保留完整数据。
- 标题、摘要、数据性质、来源和可展开数据表由受控的本地 HTML 统一排版。消息正文仍使用各端原生 Markdown。
- 同时最多保留两个图表 WebView。离屏释放绘图实例，保留上次测量的占位高度；放大预览优先取得名额，并移除原来的内联实例。
- 第一版统一使用 Canvas，限制 devicePixelRatio 最大为 2，方便控制内存和输出 PNG。SVG 与快照占位缓存留待设备性能数据支持后再引入。

## 数据链路

```text
Agent / 已有图表 Skill
  → Markdown 的 chart JSON 围栏
  → 原生解析语言与 closed 状态
  → 原生 UTF-8 100 KiB 预检、可见性与实例预算
  → 本地 WebView 的 JSON 数据桥
  → parseChartSpec（共享完整校验）
  → compileChartOption（共享白名单编译）
  → ECharts line / bar
```

共享编译器在 `packages/chart-spec/src/option.ts`，Web 的 `chart-option.ts` 继续提供原有 API。移动运行时和资源构建器分别位于 `packages/chart-spec/mobile/`、`packages/chart-spec/scripts/build-mobile.mjs`。

原生组件：

| 平台 | 入口 | 本地宿主 |
| --- | --- | --- |
| Android | `ChartMarkdownView.kt` / CommonMark | WebViewAssetLoader 的 HTTPS appassets；关闭 file/content 访问 |
| iOS | `ChartMarkdownView.swift` / MarkdownBlock.chart | WKWebView 非持久化数据存储；只读 Charts 资源目录；通过 arguments 传输 JSON |
| HarmonyOS | `ChartMarkdownView.ets` / language + closed | ArkWeb 本地 rawfile；原生操作栏 + LARGE 预览 sheet |

原生桥只接收与当前 `id`、`revision` 对应的测量、成功、错误和图片事件。已释放实例的回调无效。分享图片还必须匹配一次原生按钮点击；限制 PNG 编码/解码大小，临时目录最多保留十张图片，不向网页传入 Gateway token、Cookie 或应用级工具接口。

模型文本只通过 `textContent` 或 Canvas 文本 API 显示；不执行 HTML、JavaScript、formatter 或任意 option。页面通过 CSP 禁止连接网络、表单、对象及远程脚本，各端另有限制导航。ECharts 与 ZRender 的许可证随资源打包。

## 构建与复验

安装仓库依赖后运行：

```sh
pnpm run mobile:charts:assets
pnpm exec tsc -p packages/chart-spec/mobile/tsconfig.json
node scripts/apps/mobile-native/verify-charts.mjs
pnpm run mobile:ios:generate
```

共享运行时使用 Web workspace 锁定的同一 ECharts 版本。浏览器验证脚本默认使用已安装的 Chrome，可通过 `XOPC_CHART_TEST_BROWSER` 指定 Playwright 支持的 channel；截图写入独立临时目录。

Android preBuild、Harmony hvigor、iOS generate 已集成资源生成；三端 CI 的路径过滤器包含 `packages/chart-spec/**`。生成的 HTML/JS/许可证目录不提交到 Git。

原生测试入口：

- Android：`ChartMarkdownTest`、`ChartMarkdownViewTest`。后者经过真实 Markdown 解析和 Android WebView，检查等待围栏、折线、柱状和非法数据。
- iOS：`ChartMarkdownTests`，在真实 WKWebView 中加载应用内资源并检查两种图表及数据表；同时保留 `MarkdownBlocksTests`、`MathMarkdownTests` 回归。
- Harmony：host `tests/chartMarkdown.test.ts` 与 `tests/markdown.test.ts`；设备 Hypium suite `XopcChartMarkdown` 已注册到 List.test，但需要签名和设备才能执行。

Android Gradle 执行使用 `gradle-run` 托管包装器，实际任务为 `:app:testDebugUnitTest` 与指定 `ChartMarkdownViewTest` 的 `:app:connectedDebugAndroidTest`。

## 本次验收结果

| 检查 | 结果 |
| --- | --- |
| 共享 schema + Web option 编译器 | 26 项通过 |
| 移动宿主 TypeScript、Web TypeScript | 通过 |
| 320 / 390 / 768 宽度，两类图表 | 6 个真实 Canvas 渲染场景通过 |
| PNG 导出、过期 revision、非法 schema、全 null、中文字节超限、1000 点、释放、文本注入 | 浏览器验证通过 |
| Android 本地单元测试 | 53 项全部通过；新增图表用例 4 项 |
| Android API 35 独立模拟器 WebView | ChartMarkdownViewTest 通过，确认实际图表类型切换 |
| iOS 26.4 / iPhone 17e 模拟器 WKWebView | 图表、Markdown、公式共 9 项通过；SwiftLint 通过 |
| Harmony host Markdown 回归 | 11 项通过 |
| Harmony debug HAP / ohosTest HAP | 编译通过，输出未签名包 |
| Harmony 设备端运行 | 未执行：当前无连接设备 |

发现并修复的问题：CommonMark 未闭合围栏的 `closingFenceLength` 为 null，不能直接进行整数比较；闭合状态还必须参与流式 block fingerprint，否则已闭合的图表可能继续复用 pending block。

本次没有重新运行真实 Agent 模型矩阵；移动端沿用同一协议与 Skill。浏览器场景不替代原生设备验证。Harmony 实机、跨应用系统分享、旋转/分屏及读屏操作仍需设备补验；当前未声称这些项目通过。
