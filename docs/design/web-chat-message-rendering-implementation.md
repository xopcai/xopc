# Web Chat 消息渲染实施记录

日期：2026-10-13。对应[技术方案](./web-chat-message-rendering-technical-design.md)。P0–P6 的运行代码已落地，聊天采用单一路径；本记录区分实现完成与尚未量化的发布预算。

## 阶段结果

| 阶段 | 实施结果 |
| --- | --- |
| P0 | 合成正文/代码/长文和真实 MessageList/store 浏览器基准；保存旧 renderer 基线；parse p95、页面级 LongTask/CLS 观测 |
| P1 | Streamdown 2.7.0 + CJK 1.0.4；项目拥有链接、图片、代码和 Mermaid 组件；原始 HTML 显示为文字；sanitize 与 URL 策略显式配置 |
| P2 | Immer 只复制实际变化的 part 路径；本地 WeakMap part 身份沿流式更新、克隆和 snapshot 合并继承；历史前插复用未变化行 |
| P3 | 会话外壳、消息行、part/text run 分别订阅；文字通知按 rAF 合并，后台 50ms fallback，终态立即通知；普通文字 delta 不使历史列表重新遍历 |
| P4 | 单一呈现调度器按 backlog 追赶，250ms 积压强制收敛；中文分词、完整 grapheme；新增文字 600ms opacity 渐显；最多 256 个活动动画；初始历史不重播 |
| P5 | 开源 react-virtuoso 4.18.16，共用原滚动根；初次展示 ≥300 行的主聊天开启窗口，当前挂载期间锁定模式；全文查找先挂载目标，再收集 Range 高亮 |
| P6 | 新渲染器默认；移除聊天 HTML 分块、重复 Markdown 修补、整个 session 的帧订阅与旧环境变量回滚逻辑；完整 Web 回归及 production build |

## 实际架构与设计调整

`ChatSessionStore` 仍是唯一消息状态源。没有再维护一份规范化消息数据：WeakMap 缓存 row/part 查找索引，selector 缓存外壳快照，part hooks 读取权威内容。这样保留已有 run/cursor/offset、导出、持久化和恢复动作，避免两套数据同步。业务 mutator 通过 Immer draft 执行，不需要同时迁移全部流式回调。

partId 存在 WeakMap，消息行继续使用已有 renderKey。part 身份不写入 transcript、复制/导出结果或 API payload。相同文字的不同 part 仍具有不同身份；内容 hash 仅用于富内容缓存，不充当 React key。

Streamdown 单独负责 Markdown 分块。项目移除了外层稳定块/尾块的重复解析。引用式链接与脚注采用同一 renderer 中的完整文档策略，保持跨块语义；该策略不执行文字渐显。并非所有 Markdown 都可增量解析，单个超长段落仍有全文解析成本。

项目 rehype 插件仅包装新增/仍在动画中的 text 节点，已稳定文字合并成普通文本；动画完成后清理 span，正在选择文字时延后清理。React StrictMode 的 effect 重放会取消前一次动画，不会突破活动动画限额。Streamdown 2.7.0 按插件名称缓存 processor（100 项 LRU）；插件名包含 block 实例身份及初始/动画模式，避免不同块的闭包状态相互污染。

代码 fence 未闭合时显示完整源码，闭合且邻近/可见时复用现有 preview lease 调度高亮/图表。超过 100KiB UTF-8 不执行高亮，不截断文字或复制内容。结果缓存统一限制为 8MiB/256 项 LRU，缓存仅存净化后的 markup。highlight.js 与 Mermaid 懒加载；不可取消的绘图结果通过 effect generation 丢弃。Mermaid 继续使用项目 CSS 变量，主题变化无需重新绘图。生成的高亮/SVG 仍使用经过净化的 HTML 插入，其 React 宿主稳定；聊天 Markdown 正文已不使用 HTML 字符串替换。

文件/图片异步结果检查当前会话范围、请求 generation 和卸载状态，图片 blob URL 在卸载或来源变化时释放。局部 ErrorBoundary 保留可选择的原始内容，图表失败保留源码并可手动重试。

虚拟列表不启用独立 `followOutput`。现有滚动控制器通过 viewport adapter 调用尾部定位；Virtuoso 管理行高度和 prepend 补偿，原 scrollHeight/reading-anchor 补偿在虚拟模式跳过。查找/时间线定位先明确暂停跟随，避免测量变化把阅读者拉回尾部。普通模式用 rowId + 相对偏移恢复阅读位置。

选择消息文字或聚焦行内控件时临时扩大窗口，保持交互节点挂载；选区折叠/焦点离开后收回。此时可能暂时挂载更多历史，这是保留浏览器原生选择行为的取舍。模式按首次展示锁定：已经以普通模式打开的会话后来超过阈值，不在当前交互中替换 DOM。侧边聊天未接入全文查找与 viewport adapter，继续普通列表。

## Legacy 清理边界

删除 `use-frame-chat-session.ts`、旧聊天 streaming block builder、`prepareStreamingMarkdown` 与其专属测试；删除 `VITE_PERSONAL_PROGRESSIVE_RESPONSE` 回滚逻辑。聊天 renderer barrel 只导出新适配层，没有 legacy/streamdown 双实现开关。

共享静态文档 Markdown、marked、DOMPurify 仍有非聊天文档/预览消费者，予以保留。Mermaid 导出、工作区路径解析、app-link、安全净化和 preview scheduler 属于复用的业务能力，不复制成第二套实现。

## 验证与复现

```sh
pnpm run test:web
pnpm --dir web run lint
pnpm --dir web run type-check
pnpm --dir web run build
node scripts/test-chat-rendering.mjs final
```

浏览器脚本使用 release Vite build、React Compiler、playwright-core 和本机 Chrome，不请求真实模型或生产服务。正文、代码、长文各预热一次后记录 10 次。另对 100/300/1000 行消息执行 100 个 delta，检查最终文字完整、未挂载行定位、选择后滚动仍保留节点、前插 20 行后可见锚点 ≤2px。渐显使用真实 Web Animations/computed opacity 观察，并核对活动动画 ≤256、终态不遗留包装 span。

Vitest 新增/扩展覆盖：copy-on-write 与 part 身份、无 payload 身份泄漏、row/session selector、帧合并/后台/StrictMode/终态、Markdown 安全与引用、中文强调、escaped xopc 链接、回调更新、未闭合与 >100KiB 代码、中文/emoji 渐显与限额、阅读锚点及虚拟滚动注册清理。原有流式恢复、工具、review、消息时间和历史合并测试一并运行。

最终完整 Web 回归：428 个测试文件、2040 条测试通过；lint、TypeScript 检查、production build 和 git diff --check 通过。

最终数值见下方及[原始报告](./chat-rendering-results/final.json)。已有构建警告涉及大 chunk 和其他功能的无效动态导入；不是编译失败。

## 基准解释与边界

`commitMs` 测量调用 `flushSync(root.render)` 的同步耗时，**不是整个解析/异步高亮/真实绘制的总时间**。`deltaMs` 测量 store mutation 与同步通知，**不等于 receive→DOM 延迟**。`mountMs` 是初始同步挂载，虚拟列表需要后续 effect/测量，必须同时看 `readyMs`（出现首批行并经过下一帧）。不能用虚拟列表的亚毫秒空壳挂载宣称完整历史已经显示。

[baseline.json](./chat-rendering-results/baseline.json) 和 [streamdown.json](./chat-rendering-results/streamdown.json) 是 renderer-only harness，JS gzip 总量分别约 877KiB、1016KiB（约 +140KiB）。最终 harness 额外引入真实 MessageList/store/工具/附件等完整消息依赖，因此最终约 2MiB 的 gzip 总量不能和 renderer-only 的 877KiB 比较为首屏增量。这也没有证明技术方案的 chat 首屏 +50KiB 预算通过；Streamdown 增加解析依赖是明确成本，高亮/图表继续 lazy。

本次尚未量化端到端 receive→DOM p95、输入交互延迟、强制 GC 后的长期堆趋势与 chat 首屏 chunk 对比，亦未进行 Safari/Firefox 真浏览器验收。上述预算不能宣称已通过。引用式文档与单条超长回复仍可能需要较多 DOM/解析；窗口化限制历史行，不会虚拟化一条消息的每个 Markdown 块。

## 本机结果

最终 Chrome 155.0.8059.40，1280×800，未施加 CPU throttling；正式 report 中记录浏览器实际版本和 dirty 工作区状态。

| renderer 场景 | 旧同步提交 p95 | 最终同步提交 p95 | 最终 DOM 节点 |
| --- | ---: | ---: | ---: |
| 连续混合正文 | 0.4ms | 2.5ms | 243 |
| 约 21KiB 代码 | 35.1ms | 10.1ms | 2115 |
| 300 段单条长文 | 20.8ms | 24.9ms | 903 |

三组各 10 次正式样本均无 >50ms LongTask，检查未丢失或重复可见文字。正文在 16ms 同步提交预算内，代码耗时降低；长文同步提交增加约 20%，**没有满足原设计“全部场景不恶化超过 10%”的门槛**。React Markdown 的稳定节点、安全语义和渐显增加了处理成本，此报告不将其掩盖为全面性能提升，也不把尚未测量的总解析时延判为通过。

| 实际 MessageList/store | 首批行 + 下一帧 readyMs | store delta p95 | tail DOM 节点 |
| --- | ---: | ---: | ---: |
| 100 行普通列表 | 74.2ms | 0.7ms | 2385 |
| 300 行窗口 | 97.2ms | 0.3ms | 367 |
| 1000 行窗口 | 88.4ms | 0.2ms | 367 |

窗口化前的单次控制测量：1000 行普通列表同步挂载约 353.9ms、23,534 个 DOM 节点、store delta p95 约 1.3ms。此值来自窗口实施前的诊断，不属于 renderer-only baseline；不把单次测量比较作为稳定倍数承诺。最终长历史尾部挂载 13 行，普通阅读时 DOM 不再随已加载历史总行数线性增加。300/1000 行均成功定位未挂载的第 50 行，选择并滚动后选区节点保持连接，前插 20 行可见锚点实测偏移 0px。

真实动画抽样为 39 个 active animation，computed opacity 处于 0–1；终态 span 清理成功，浏览器 pageerror 为 0。参考[渐显截图](./chat-rendering-results/final-streaming.png)与[历史定位截图](./chat-rendering-results/final-history.png)。

## 二次效果验收

后续链接与排版复查修复了外链错误反馈、脚注/中文 fragment 定位、内部 ID 与文件路径识别的优先级、裸 JSX/TSX 文件名、列表标记、表格独立滚动和代码重复 padding，并恢复无语言标签 Mermaid 识别。细节及截图见[效果复查记录](./web-chat-message-rendering-review.md)。上述早期基准 JSON 保留其测量时版本；不能将它们当作新增修复后的重新测量。
