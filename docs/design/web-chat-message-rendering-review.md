# Chat Markdown 效果与链接复查

日期：2026-10-13。复查使用项目真实 React 组件、全局样式、Figtree 字体和合成 Markdown 样例，不调用模型或修改真实会话。

## 修复结果

| 发现的问题 | 修复 |
| --- | --- |
| 外部打开失败只有 title 提示 | 恢复可见、可访问的错误反馈；忽略旧请求返回，内容替换后清理错误 |
| 脚注被识别为外部 HTTP 链接，sanitize 后 ID 与引用不匹配 | 生成消息独立的 fragment ID；引用、回链和 ARIA 引用同步映射；在当前消息内滚动/聚焦，保留聊天路由 |
| 中文或包含百分号的脚注跳转失败 | 优先匹配实际 DOM ID，再尝试 URI 解码后的 ID；增加中文、百分号和 `.md` 标识用例 |
| `report.md` 等文件形状的内部对象 ID 可能误判为工作区文件 | 已知 app 路由优先于文件识别；链接与图片在 reference 解析完成后分别归一化，避免图片引用被改成 app 路由 |
| 裸 `.tsx/.jsx` 文件名没有自动链接 | 修复扩展名正则的短前缀重叠，保留完整路径与行号 |
| 无序列表圆点、有序列表序号被 Tailwind reset 隐藏 | 恢复 disc/decimal 和嵌套 circle/square；任务列表维持 checkbox |
| 窄阅读栏里表格标题和数字被拆成多行 | 保留语义 table，在独立可聚焦容器中横向滚动；每列最小 6rem，数字列不换行 |
| 高亮代码同时受 pre/code padding 与滚动影响 | pre 统一负责内边距与滚动，移除 code 的重复 padding/scrollport |
| 无语言标签 Mermaid 未继承旧识别行为 | 提取共享轻量 source detector，仅识别支持的图表头，不影响明确命名的其他语言 |

另保留链接的描述性 title，规范化同源绝对 hash 路由；清理无调用点的旧 `markdown-stream-tail` CSS。

## 链接行为核对

| 类型 | 验证内容与结果 |
| --- | --- |
| 内部会话 | xopc deep link、裸链接、尖括号、转义链接和 reference link 均生成内部 href 并路由到目标会话 |
| 内部产物 | 笔记、任务、项目、工作流、自动化、本地应用沿用项目 opener；聊天中保留 note/task/preview 模式，设置与编辑页仍正常导航 |
| 文件 | 中文文件名、相对路径、绝对路径、file URL、xopc workspace URL、行号、空格编码；浏览器点击回调收到正确的 path/kind/line |
| 外部 URL | HTTP(S)、localhost 服务、query/hash 和中文参数；保持 `_blank`、noopener/noreferrer，使用现有 Electron bridge/browser opener |
| 修饰键 | Ctrl/⌘/Shift 点击不被普通 opener 截获，保留浏览器原生行为 |
| 不支持或危险协议 | 缺少目标的 xopc、javascript、mailto 等维持不可操作的普通文字，不添加可用性噪音 |
| 脚注 | 当前消息内定位、回链、中文标识、独立 ID、焦点；不打开外部页面或改变 HashRouter 路由 |

[浏览器采集的链接属性](./chat-rendering-results/review-links.json)包含 16 个预期链接；流式完成后的动画包装 span 为 0。单元测试进一步覆盖 ID 形状、reference image、描述性 title、过期错误与两个消息之间的 fragment 隔离。

## 排版与视觉检查

检查了浅色/深色、中英混排、强调、段落、h1–h5、引用、嵌套列表、从 3 开始的有序列表、任务列表、表格对齐、长代码、Mermaid 和流式追加。正文沿用真实聊天的 16px / 27px 行高；首段与段落间距保持既有阅读节奏。

在 375px **阅读容器**中（不是完整手机设备仿真），实际消息内容宽 347px，scrollWidth 同为 347px。8 列宽表内部宽 768px，可通过键盘横向滚动，消息本身不超宽；长代码仅 pre 横向滚动。3 列表格标题不拆字，300 保持一行。脚注跳转后 document hash 保持不变，焦点落在当前消息对应脚注。

浏览器为 Codex 内置浏览器；深浅样例已实际观察。本轮新打开的 Gateway 页面停留在令牌登录界面，因此没有验证鉴权后的真实文件读取/业务详情加载；文件回调与路由目标已在真实组件中验证。服务端文件存在性不属于本轮已通过结论。

效果截图：

![浅色排版](./chat-rendering-results/review-typography-light.jpg)

![深色表格与代码](./chat-rendering-results/review-table-code-dark.jpg)

![窄阅读栏宽表](./chat-rendering-results/review-wide-table.jpg)

![链接样例](./chat-rendering-results/review-links.jpg)

## 复现

```sh
pnpm --dir web run dev --host 127.0.0.1 --port 4217 --strictPort
# /src/visual-tests/chat-markdown-review/index.html
pnpm run test:web
pnpm --dir web run lint
pnpm --dir web run type-check
pnpm --dir web run build
```

新链接兼容测试迁移了共享文档渲染器的既有用例，继续覆盖应用路由与聊天内预览语义；没有重新引入聊天 legacy renderer。

最终验证：当前工作区完整 Web 回归 **430 个测试文件、2095 条测试通过**；lint、TypeScript 编译检查、production build 与 git diff --check 通过。构建仍有项目既有的大 chunk/无效动态导入提示。
