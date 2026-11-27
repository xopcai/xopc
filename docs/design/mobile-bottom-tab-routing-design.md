# xopc 移动端底部 Tab 与路由架构设计

> 适用范围：**仅针对原生移动端三端（iOS / Android / HarmonyOS）**，`web/` 保持不变。
> 设计基线：2026-11-27（5 固定底栏 + 扁平化侧栏版），参考 Meta Muse 移动端信息架构与 [移动端 P0 导航规范](mobile-p0-navigation-2026-11-11.md)、[三端信息架构盘点](mobile-information-architecture-audit-2026-11-11.md)。

---

## 1. 产品设计理念与核心分工

> **底部 Floating Pill（5 固定槽）承载每日高频内容空间，左侧抽屉（`ChatSidebar`）彻底去重并扁平化展开原本深埋的能力、自动化、分享与个人配置菜单。**

- **底栏与侧栏零重叠**：
  - **底栏（5 槽）**：`[ Ada · 对话 · 工作台 · 笔记 · 资料库 ]`——覆盖「主助理长驻对话、全部多会话列表、进展/任务/项目、笔记与录音、资料库资产」五大高频内容域。
  - **侧栏抽屉**：不再堆叠重复的最近对话列表，改为分组展开的直达导航，把原“能力”内嵌的 6 项（`插件 / 技能 / 连接 / 设备 / 智能体 / 消息通道`）以及 `自动化 / 分享中心 / 关于我 / 目标` 全部提升到 1 步直达。

---

## 2. 整体信息架构

### 2.1 底部 Floating Pill（5 固定槽 + 预留动态槽）

| 槽位 | Tab ID | 图标与短标签 | 挂载的 L0 根页 | 角标 / 状态 |
|---|---|---|---|---|
| **1** | `ada` | **Ada 头像** + `Ada`（随自定义名同步） | 个人助理唯一主对话（永久锁定 `personalAgent.conversationId`） | `personalUnread` 未读数 / 运行态光点 |
| **2** | `conversations` | 对话列表图标 + `对话` | 全部对话列表（`最近 / 项目 / 专家` 顶栏下拉、搜索、置顶、父子任务展开、`+` 新建对话） | — |
| **3** | `workbench` | 工作台图标 + `工作台` | 工作台（`进展 / 任务 / 项目` 顶栏下拉） | `pendingAttention` 待处理数 |
| **4** | `notes` | 笔记图标 + `笔记` | 笔记与录音（`全部 / 收件箱 / 已整理 / 已归档` 顶栏下拉） | 待恢复录音提示点 |
| **5** | `library` | 资料库图标 + `资料库` | `SpaceLibrary`（交付成果 / 文件 / 媒体） | — |
| *预留* | `pinnedSpace(id)` | 空间缩略图 | 数据模型保留扩展能力，支持未来动态 Pin 空间 | — |

### 2.2 左侧抽屉（`ChatSidebar`）扁平化分组结构

```text
ChatSidebar（左侧抽屉 — 零重复、直达内嵌能力与个人域）
├─ 顶部：xopc 品牌 + 关闭
├─ 搜索对话（胶囊 → L1 ConversationSearch）
├─ 分组 1「能力」（原能力内嵌 6 项直接展开，1 步直达对应分区）
│   ├─ 插件（plugins）
│   ├─ 技能（skills）
│   ├─ 连接（connections）
│   ├─ 设备（devices）
│   ├─ 智能体（agents）
│   └─ 消息通道（channels）
├─ 分组 2「工作与工具」
│   ├─ 自动化（automations）
│   └─ 分享中心（shareCenter）
├─ 分组 3「我的」
│   ├─ 关于我（aboutYou）
│   └─ 目标（personalGoals）
└─ 底部固定栏：新建对话（主按钮） + 设置（齿轮）
```

### 2.3 视觉与顶栏统一规范

1. **顶栏下拉统一 & 消除横滑冲突**：`对话（最近/项目/专家 ⌄）`、`工作台（进展/任务/项目 ⌄）`、`笔记（全部/收件箱/已整理/已归档 ⌄）`、`资料库（全部资料/收藏/回收站 ⌄）` 全部统一采用顶栏标题下拉切换，**禁用所有底栏 L0 根页内的左右滑切子页手势**，统一由用户点击顶部标题菜单手动切换，同时将中段右滑手势（避开系统边缘返回区）100% 专属于呼出左侧抽屉；侧栏展开的能力子页（`插件 / 技能 / 连接 / 设备 / 智能体 / 消息通道`）直达各自特定页面，顶栏仅展示静态标题，不再提供顶栏下拉切换与左右横滑切换。
2. **普通对话顶栏精简与左对齐标题栏**：左侧 `< 返回`，紧接**左对齐透明底双行标题区**（按压带轻圆角反馈，点击即打开会话选项/设置，移除实底卡片与居中偏斜）；右侧仅保留语音播报（端支持时）及手机工作区/浏览器预览等按需上下文入口，**移除右侧重复设置按钮与「切换会话」按钮**；**「语音通话」下沉至底部 `+` 扩展动作面板**（Ada 主对话顶栏继续保留居中头像与右上角语音通话直达入口）。
   - **已有标题对话**：第一行显示 `对话标题 ⌄`（`16pt SemiBold`）；第二行在默认助手时隐藏重复助手名、仅显示 `模型名` + `· 思考强度 ⚡`（优先保留思考/快速标记、仅截断过长模型名），在非默认专家助手时显示 `[14pt 助手头像] 助手名 · 模型名 · 思考强度 ⚡`（头像与助手名语义归位）。
   - **新对话/无标题草稿**：不展示“新对话”占位，直接将 `[18pt 助手头像] 助手名 ⌄` 升至第一行，第二行显示 `模型名 · 思考强度 ⚡`。
3. **Ada 主屏三层叠放底线**：键盘弹起必藏底栏；滚动长对话自动折叠 Ada 大头像；键盘收起时输入框与底栏胶囊保持 `10–12pt/dp/vp` 间距；音乐迷你条与录音面板统一消费 `bottomChromeInset`。

---

## 3. 四级路由分层与显隐铁律

```text
showBottomTabBar      = activeStack.isEmpty && !imeVisible && !fullScreenOverlayActive
allowSidebarEdgeSwipe = activeStack.isEmpty && !fullScreenOverlayActive
```

- **L0（Tab 根页，`activeStack.isEmpty`）**：显示底部 Floating Pill；顶栏左侧 `=` 打开侧栏；允许左边缘右滑拉出侧栏。
- **L1（栈内推送页，`activeStack.count > 0`）**：强制隐藏底栏；顶栏左侧 `< 返回`；左边缘手势交还系统原生右滑返回。
- **L2（局部弹层）**：Sheet / Dialog 覆盖当前页。
- **L3（全局覆层）**：实时语音、手机工作区、全屏播放器。

---

## 4. 三端统一路由规则

### 4.1 5 条独立导航栈
- `stacks`: `ada`、`conversations`、`workbench`、`notes`、`library`（外加预留 `pinnedSpace(id)`）。
- 切换 Tab 保留各 Tab 导航栈与滚动位置；二次点击当前激活 Tab 时若栈非空执行 `popToRoot()`，已在根页则滚顶/复位默认子视图。

### 4.2 对话域路由规则（`ada` vs `conversations`）
1. **`Ada` Tab（`adaStack`）**：L0 根页永久锁定 `personalAgent.conversationId`，不与普通会话共享可变选中态。仅当 `selectedTab == ada && adaStack.isEmpty && !sidebarOpen && foreground && !fullScreenOverlayActive` 时清除 Ada 未读计数。
2. **`对话` Tab（`conversationsStack`）**：
   - L0 根页为全部普通对话列表（不重复展示已锁定在 Tab 1 的 Ada 主对话，或在点击 Ada 时自动切至 `selectedTab = ada, adaStack = []`）。
   - 点击任意普通对话 → 压入 `conversationsStack`: `[SessionChat(id)]`（L1，隐藏底栏，返回直达对话列表并保留滚动位置与分组状态）；切换会话通过 `< 返回` 回到对话列表选择，不再在顶栏提供快捷切换按钮。
   - 点击 Tab 2 顶栏 `+` 或侧栏底栏「新建对话」→ 切至 `selectedTab = conversations`，压入/替换 `[SessionChat(draft)]`，首条消息落库后**原地更新 `conversationId`**（不 pop+push）。
   - 在对话列表展开父会话点击任务子行 → 压入 `conversationsStack`: `[TaskChat(taskId)]`，返回保留父会话展开状态。
   - 当前打开的普通对话被删除 / 404 → 自动 `pop()` 回 `conversations` 根页。
3. **搜索进入普通对话**：在 `ConversationSearch` 点击命中普通对话，压在 `ConversationSearch` 之上以便返回继续翻看搜索结果；命中 Ada 则直切 `selectedTab = ada, adaStack = []`。

### 4.3 侧栏扁平入口与推送合成栈
- **侧栏能力直达**：点击侧栏 `插件 / 技能 / 连接 / 设备 / 智能体 / 消息通道` → 关闭侧栏，原地压入当前激活 Tab 的栈顶 `Capabilities(initialCategory: category)`（L1，直接进入对应的单一能力页面，顶栏为静态标题，不提供顶栏下拉或左右横滑切换）。
- **侧栏工具与个人直达**：点击 `自动化 / 分享中心 / 关于我 / 目标 / 设置 / 搜索对话` → 关闭侧栏，原地压入当前激活 Tab 的栈顶（L1），返回直接回到拉侧栏前的页面。
- **推送 / Deep Link 合成栈**：
  - Ada 对话 → `ada: []`
  - 普通对话 `cid` → `conversations: [SessionChat(cid)]`
  - 任务详情 `tid` → `workbench: [TaskDetail(tid)]`
  - 任务对话 `tid`（冷启动）→ `workbench: [TaskDetail(tid), TaskChat(tid)]`
  - 自动化运行 `rid` → `workbench: [Automations, AutomationRun(rid)]`
  - 笔记 `nid` → `notes: [NoteDetail(nid)]`
- **系统返回优先级（Android / HarmonyOS）**：(1) 键盘 / 输入面板 / L2 弹层 → (2) 关闭侧栏 → (3) `activeStack.pop()` → (4) 非 `ada` Tab 切回 `ada` → (5) 交还系统。
- **Gateway 切换 / 移除**：原子清空全部 5 条栈、关闭侧栏、重置 `selectedTab = ada`。
