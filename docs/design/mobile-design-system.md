# xopc 移动端三端统一设计与交互规范（iOS · Android · 鸿蒙）

> **版本**：v1.2 · **适用范围**：
> - **iOS**：`apps/mobile-ios`（SwiftUI / iOS 17+，141 文件 / ~3.93 万行）
> - **Android**：`apps/mobile-android`（Jetpack Compose + Material 3，129 文件 / ~74 UI 文件）
> - **鸿蒙**：`apps/mobile-harmony`（ArkTS ComponentV2 / HarmonyOS API 23+，71 视图 / ~4.02 万行）
>
> **上位宪法**：继承 [ui-design-system.md](./ui-design-system.md) 的 **Calm Intelligence（沉静智能）**——“灰色是主角，强调色是信号；界面安静克制，动效服务于空间连续性”。\
> **核心目标**：建立**一套跨端一致的交互心智与设计语言**，降低用户在页面之间与设备之间切换的认知成本。

---

## 0. 三端演进状态全景

| 维度 | iOS (`mobile-ios`) | Android (`mobile-android`) | 鸿蒙 (`mobile-harmony`) |
| --- | --- | --- | --- |
| **主题色渗透率** | **已落地**：核心页面/弹窗补齐 `mobileTheme`，`ClarificationCard` 硬编码 Hex 与描边已归零；`MobileTheme` 补齐 `scrim / dangerSoft / success / warning*` | **已落地**：全量走 `MaterialTheme` + `LocalStatusColors` / `LocalAttentionColors`；业务硬编码 `Color(0x)` 与 `ClarificationCard` 描边已归零 | **已落地**：全量走 `appThemeColors`；补齐 `scrim / warning / dangerSoft`；业务 Hex 与描边已归零 |
| **共享底座** | **已落地**：`MobileDesignTokens.swift`、`MobileMotion.swift`、`MobileSheet.swift`、`MobileStates.swift`、`MobileTheme.swift`、`SegmentedTabs.swift` | **已落地**：`DesignTokens.kt`、`MotionTokens.kt`、`MobileChrome.kt`（补齐 `XopcInlineBanner` / `XopcUndoBar` / `XopcBatchActionBar` / `XopcButton` / `XopcCard` / `XopcBadge` / `xopcShowToast`） | **已落地**：`designTokens.ets`、`motionTokens.ets`、`dialogActions.ets`、`view/ui/*`、`MobileComponents.ets` |
| **顶栏与导航** | `NavigationStack` + `.mobilePageTitle` 全覆盖，统一 `ellipsis.circle` | **已落地**：全量收敛 `XopcPageHeader`（零散落 `PageBackButton`） | **已落地**：`XopcPageHeader` 全收敛（补齐 `FilesView` 返回与标题），统一 `arrow_left` / `ellipsis_circle` |
| **Sheet 与 Dialog** | **已落地**：`MobileSheetPreset` 4 档 preset + `MobileSheetHeader` / `MobileCloseButton` 落地核心弹窗 | **已落地**：100% `XopcBottomSheet`（`Immersive` 隐藏拖拽条）、核心确认弹窗收敛 `XopcConfirmDialog`、`XopcSheetHeader` 落地 | **已落地**：21/21 文件 `xopcSheetOptions`、`xopcConfirmDialog`，`showAlertDialog` / `showActionSheet` 已归零 |
| **搜索与刷新** | `.searchable()` + 消除 `CapabilitiesView` 残留原生 `Picker(.segmented)` | **已落地**：100% `XopcPullToRefreshBox`（零裸 `PullToRefreshBox`）+ `XopcPageSearchField` | **已落地**：`CapabilitiesView` / `FilesView` 顶部展开搜索，10 页接入 `Refresh`，`SessionsView` / `NotesTabView` 升级 `Swiper` |
| **状态与反馈** | **已落地**：`MobileListSkeleton` / `MobileInlineBanner` / `MobileUndoBar` / `MobileErrorView` / `MobileEmptyState` | **已落地**：`XopcErrorState` / `XopcEmptyState` / `XopcListSkeleton` / `XopcInlineBanner` / `XopcUndoBar` / `XopcBatchActionBar` 全线接入 | **已落地**：`XopcErrorState` / `XopcEmptyHint` / `XopcInlineBanner` / `XopcUndoBar` / `XopcBatchActionBar` / 呼吸骨架屏 |
| **动效、触觉与守卫** | **已落地**：`MobileMotion` + `reduceMotion` 全守卫 + `UIArchitectureGuardTests`（148 tests passed） | **已落地**：`rememberMotionAllowed()` / `xopcPagerAnimated` + `UiArchitectureGuardTest`（`testDebugUnitTest` passed） | **已落地**：`motionTokens` 全接入、`clickEffect` + 长按触觉 + `uiInteractionConsistency.test.ts`（954 tests passed） |

---

## 1. 跨端统一原则与平台原生边界

### 1.1 总原则：**交互契约 100% 统一，平台载体尊重原生**
- **三端必须一致（认知层）**：4 套主题与圆角倍率、色阶分层、空间节奏、顶栏结构与多视图切换心智、4 档 Sheet 语义、破坏性确认规范、加载/空/错/轻提示语义、动效时长阶梯（`140 / 180 / 220 / 230 / 280 / 1200ms`）与 `reduceMotion` 守卫、触觉触发时机。
- **尊重各平台原生（承载层）**：

| 能力域 | 统一契约（三端一致） | iOS 原生载体 | Android 原生载体 | 鸿蒙原生载体 |
| --- | --- | --- | --- | --- |
| 导航与返回 | 单栈推进，子页均有返回入口与侧滑返回 | `NavigationStack` + 系统侧滑返回 | 系统预测返回手势 + `XopcPageHeader` | `Navigation(Stack)` + `XopcPageHeader` |
| 列表搜索 | 顶部展开/收起，图标单一语义（不兼职开市场） | `.searchable()` | `PageSearchButton` + `XopcPageSearchField` | `XopcPageSearchButton` + `XopcPageSearchField` |
| 下拉刷新 | 所有核心异步列表页统一支持下拉刷新 | `.refreshable` | `XopcPullToRefreshBox`（Loopi 指示器） | `Refresh` |
| 行上下文操作 | 长按呼出菜单 + 触觉反馈；危险项置底标红 | `.contextMenu` + 核心列表 `.swipeActions` | `combinedClickable(onLongClick)` + `DropdownMenu` + `LongPress` 触觉 | `bindContextMenu(HapticFeedbackMode.ENABLED)` |
| 瞬时反馈 / 撤销 | 轻提示不阻断操作；破坏性可撤销操作用底部胶囊条 | `MobileToast` / `MobileUndoBar` | `Snackbar` / `XopcUndoBar` | `xopcToast()` / `XopcUndoBar` |
| 按压与触觉 | 轻克制按压态 + 分级触觉 | `MobilePressStyle` + `.sensoryFeedback` | Compose Ripple + `LocalHapticFeedback` | `.clickEffect(LIGHT, 0.98)` + `HapticFeedbackMode` |

### 1.2 统一范围 vs 领域定制边界
- **全量统一域**：工作台（进展 / 任务 / 项目 / 自动化）、会话管理、笔记列表、文件、资料库、能力中心、关于你、个人目标、分享中心、设置、网关管理、模型设置。
- **外层 Chrome 统一、核心画布定制域**：主对话流与输入区（iOS `AssistantView` / Android `MainScreen` Chat / 鸿蒙 `ChatView`）、实时语音通话、音乐播放器、原生笔记编辑器、手机投屏。保留核心领域交互，但**返回/关闭、Sheet 档位、确认弹窗、轻提示、长按菜单、动效 Token** 必须遵守本规范。

---

## 2. Design Tokens（三端映射对照表）

### 2.1 语义色板与无边框层级
三端严格共用同一套 4 主题预设（`default / porcelain / emerald / clay`）× 深浅模式：
- **层级铁律**：界面靠**背景色阶差**表达层级（`canvas/background` < `panel/surface` < `input/surfaceContainer`），禁止装饰性描边与重阴影。
- **缺失语义 Token 三端统一**：

| 语义角色 | iOS (`MobileTheme`) | Android (`XopcTheme` / `Local*`) | 鸿蒙 (`XopcThemeColors`) | Light / Dark 基准 |
| --- | --- | --- | --- | --- |
| 模态遮罩 | `scrim` | `colorScheme.scrim` | `scrim` | `#52000000` / `#66000000` |
| 警告底色 | `warningFill` | `LocalAttentionColors.fill` | `warningFill` | `#FEF3E2` / `#352A18` |
| 警告前景 | `warningForeground` | `LocalAttentionColors.foreground` | `warningForeground` | `#92400E` / `#FBBF24` |
| 危险柔底 | `dangerSoft` | `colorScheme.errorContainer` | `dangerSoft` | `#FDECEC` / `#351E22` |

### 2.2 空间栅格与圆角（`pt = dp = vp`）

| Token | 数值 (`pt / dp / vp`) | 用途 |
| --- | --- | --- |
| `PagePaddingX` | **16** | 所有标准页面的左右安全边距 |
| `SheetPaddingX` | **20** | Sheet 内容区左右内边距 |
| `CardPaddingCompact` / `CardPadding` | **14** / **16** | 紧凑 / 标准卡片内边距 |
| `ItemGap` / `GroupGap` / `SectionGap` | **8** / **12** / **24** | 列表项 / 表单与组内 / 分区间距 |
| `ButtonHeightSm` / `Md` / `Lg` | **36** / **44** / **48** | 全站按钮高度收敛为 3 档（最小热区 `44`） |
| `RadiusXs / Sm / Md / Lg / Pill` | **8 / 12 / 16 / 20 / 999** | 均经主题圆角缩放（`emerald ×0.8`, `clay ×1.2`） |
| `IconHeader / IconRow / IconChevron` | **20 / 18 / 14** | 顶栏图标 / 行内图标 / 箭头尺寸 |
| `DisabledAlpha` | **0.42** | 全站统一禁用透明度 |

### 2.3 字阶与高频符号唯一映射

| 操作语义 | iOS (`SF Symbols`) | Android (`R.drawable.action_*`) | 鸿蒙 (`sys.symbol.*`) |
| --- | --- | --- | --- |
| 返回 | 系统返回 / `chevron.left` | `action_back` | `arrow_left` |
| 关闭 | `xmark` | `action_close` | `xmark` |
| 更多 / 溢出 | `ellipsis.circle` | `action_more` | `ellipsis_circle` |
| 搜索 | `magnifyingglass` | `action_search` | `magnifyingglass` |
| 新建 | `plus` | `action_add` | `plus` |

---

## 3. 导航、顶栏、多视图切换与搜索契约

- **顶层模块切换**（如进展/任务/项目，插件/技能/连接）：顶栏 `PageTitleMenu` + 横向分页（iOS `TabView.page` / Android `HorizontalPager` / 鸿蒙 `Swiper`）。
- **页内维度切换**（如全部/收件箱/归档，进行中/已完成）：`SegmentedTabs` + 横向分页 + 跟手指示器。
- **搜索契约**：统一在页面顶部展开/收起；放大镜图标严格单一语义，不再复用为技能市场入口。

---

## 4. 弹窗、半屏抽屉与菜单契约

### 4.1 Sheet 四档统一预设

| 档位 Preset | 高度规范 | 拖拽条 | 默认底色 | iOS (`MobileSheetPreset`) | Android (`XopcBottomSheet`) | 鸿蒙 (`xopcSheetOptions`) |
| --- | --- | --- | --- | --- | --- | --- |
| **`compact`** | 约 `45%` / `340pt` | 显示 | `panel / surface` | `[.height(340), .medium]` | `heightIn(max = 0.50f)` | `height: '45%', dragBar: true` |
| **`medium`** | 约 `70%` | 显示 | `panel / surface` | `[.fraction(0.72), .large]` | `heightIn(max = 0.72f)` | `height: '70%', dragBar: true` |
| **`large`** | 约 `88%` / `LARGE` | 显示 | `panel`（能力面板用 `canvas`） | `[.fraction(0.88), .large]` | `heightIn(max = 0.90f)` | `height: SheetSize.LARGE, dragBar: true` |
| **`immersive`** | `94%` | 隐藏 | `chat.canvas / panel` | `[.fraction(0.94)]` + `.hidden` | `fillMaxHeight(0.94f)` + `dragHandle = null` | `height: '94%', dragBar: false` |

### 4.2 确认弹窗与上下文菜单
- **确认弹窗铁律**：左取消（次要色）/ 右主操作（常规强调色、破坏性 `danger` + 具体动作动词）。
- **列表项上下文菜单**：长按呼出带触觉反馈的上下文菜单，常规操作在前、破坏性操作置底标红；多选态三端统一“顶栏计数 + 底部悬浮胶囊 `BatchActionBar`”。

---

## 5. 动效与触控/触觉反馈契约（三端同频）

| Token | 时长 | 标准曲线 | iOS (`MobileMotion.swift`) | Android (`XopcMotionTokens`) | 鸿蒙 (`motionTokens.ets`) |
| --- | --- | --- | --- | --- | --- |
| `Micro` | **140ms** | EaseOut | `.easeOut(duration: 0.14)` | `MicroMs = 140` | `XOPC_MOTION_MICRO_MS` |
| `Exit` | **180ms** | EaseIn / Standard | `.easeIn(duration: 0.18)` | `ExitMs = 180` | `XOPC_MOTION_EXIT_MS` |
| `Standard` | **220ms** | `CubicBezier(0.32, 0.72, 0, 1)` | `.timingCurve(0.32, 0.72, 0, 1, duration: 0.22)` | `StandardMs = 220` + `StandardEasing` | `XOPC_MOTION_STANDARD_MS` |
| `Pager` | **230ms** | EaseOut / Standard | `.easeOut(duration: 0.23)` | `PagerMs = 230` | `XOPC_MOTION_PAGER_MS` |
| `Emphasis` | **280ms** | 轻阻尼弹簧 | `.spring(response: 0.28, dampingFraction: 0.86)` | `EmphasisMs = 280` | `XOPC_MOTION_EMPHASIS_MS` |
| `Skeleton` | **1200ms** | 往复呼吸 | `repeatForever(autoreverses: true)` | `SkeletonMs = 1200` | `XOPC_MOTION_SKELETON_MS` |

---

## 6. 三端自动化架构守卫（CI 防回退）
- **鸿蒙**：`apps/mobile-harmony/tests/uiInteractionConsistency.test.ts`
- **Android**：`apps/mobile-android/app/src/test/java/ai/xopc/mobile/ui/main/UiArchitectureGuardTest.kt`
- **iOS**：`apps/mobile-ios/XopcMobileTests/UIArchitectureGuardTests.swift`

四条跨端共同红线：
1. **色值守卫**：禁止视图层新增业务硬编码 Hex / `Color(0x)`；
2. **动效守卫**：禁止绕过 `reduceMotion` 的裸动画与散落硬编码切页时长；
3. **弹窗/菜单守卫**：强制使用各端统一 Sheet 预设与 ConfirmDialog，禁止散落遗留弹窗 API；
4. **符号与主题守卫**：统一溢出图标（禁止 `dot_grid_1x2` / `Text("⋯")`），iOS Feature 视图强制接入 `mobileTheme`。
