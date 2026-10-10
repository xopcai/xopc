# 鸿蒙小环接入 v1.0

## 1. 目标
将已确认的 Web Loopi 品牌形象原生接入鸿蒙，表达温和陪伴，不模拟任务成功。

## 2. 范围
新建 Chat、助手 Tab、个人理解入口、关于你页；保留原导航、用户姓名缩写、数据与加载/错误反馈。不新增依赖、路由、权限或后端接口。

## 3. 视觉区域
Chat 沿用并行更新后的欢迎布局尺寸（紧凑 88vp、常规 108vp）、Tab 28vp、个人入口 44vp、关于你 64vp。沿用 Web 薄陶瓷矢量材质，石墨长弧、蓝色短弧、象牙核心，品牌色封装在媒体资源，暗色资源提升环的对比度。脸部不旋转。文字保留现有字号及 themePalette 前景/次级色。

## 4. 交互
- Chat 出现 → 温和呼吸、非固定间隔眨眼/眼神 → 自动循环；触摸小环 → 短暂笑眼 → 恢复；不发送消息、不抢焦点，保留原收键盘行为。
- 选中助手 Tab → 一次轻回应 → 静止；保留导航、选中语义与其他 Tab 角标。
- 点击个人卡 → 原 about-you 路由 → 关于你页面；小环不拥有嵌套点击，用户缩写保留。
- 关于你加载/保存 → 专注姿态；失败 → 温和姿态；正常 → 倾听。原骨架、重试、搜索、编辑不变。
- 离开页面、不可见、后台、减少动态 → 取消所有计时并复位 → 恢复可见时重新开始，不补播。

## 5. 多设备
手机沿用当前纵向布局；平板及展开折叠屏沿用既有内容宽度与 dock，不新增断点。小环固定 vp 尺寸、不占额外全屏区域，欢迎区继续可滚动；大字模式仍由文字原布局处理。

## 6. 状态模型
组件参数 extent、activePage、compact、mood、interactive；共享 layout.reduceMotion / foreground。内部 pose（浮动、环角度、视线、眼睑）仅用于展示，无持久化。motion 控制器不依赖网络或 ArkUI。

## 7. 无障碍及性能
角色为装饰，不加入屏幕阅读焦点；保留宿主按钮文本。原生 transform 动画、静态 SVG 分层，无逐帧 JS 绘图或无限原生动画；每个角色最多有限组可取消 timeout。

## 8. 文件结构
新增 view/Loopi.ets、common/loopiMotion.ets、media/loopi_* 资源与 tests/loopi-motion.test.ts。修改四个页面及 HomeView/ChatView，复用 layoutState 与 EntryAbility 前后台回调。复用 MobileComponents 骨架，不替换已有加载器。

## 9. 接口映射
`Image(ResourceStr)` / width / height / translate / rotate / scale：SDK 内置，不需 import。`onVisibleAreaChange([0, 0.5], (isExpanding:boolean, currentRatio:number)=>void)` 提供可见比例。`getUIContext().animateTo(AnimateParam, ()=>void)` 仅在可见后的调度回调调用；0ms 复位直接赋值。setTimeout 返回 number，clearTimeout 取消。@ComponentV2 / @Local / @Param / @Monitor 使用当前工程范式。无需新增 Kit API；原系统减少动态读取失败继续保持 true。

## 10. 决策
用户“按照以上方案实现”确认调研方案：手机优先、保留本人头像、现有 Web 形象为基准。无阻塞项，不需要业务 Feature Flag。

## 11. 验收
编译、motion 单测及可用设备验证分别记录；没有设备截图不得声称真机视觉通过。

2026-10-03 实施结果：

- DevEco MCP `check_ets_files`：新组件、motion、个人页、生命周期文件无诊断；既有 ChatView/HomeView/AboutYouView 有未使用符号和异常处理警告，无新增小环错误。
- DevEco MCP `build_project`：最终 Debug HAP 构建成功；产物为 `entry-default-unsigned.hap`，当前 default 产品没有签名配置。
- `tests/loopi-motion.test.ts`：8/8 通过，覆盖静态降级、循环、Tab 单次响应、停止/恢复、真实 mood、连续触摸及销毁。
- 鸿蒙全套：604 通过 / 3 失败；针对失败重跑仍相同。`chatViewModel.test.ts` 重试调用新增尾参数与断言不一致；`sessionMenu.test.ts` 测试 Handler 未提供 onDelete；`mobileLoadingExperience.test.ts` 依赖旧 pendingChatId 源码断言。对应逻辑未被本次品牌接入修改，不在本次修复范围。
- `git diff --check` 通过。
- DevEco MCP `start_app` 尝试 Pura 90 Pro 模拟器，返回 `Timeout waiting for emulator to start`。未完成手机/平板/折叠屏视觉、实际帧率与系统减少动态设备验收，也未安装到用户真机。

验收入口：助手 → 新建对话；切换助手 Tab；我的 → 个人卡片 → 关于你。设备可用后需检查深浅模式、大字、前后台、切换 Tab、滚动不可见及减少动态；保留用户本人缩写，触摸角色不发消息。

### 11.5 技术校准
| 维度 | 结论 |
| --- | --- |
| 接口 | 已核对本机 SDK common.d.ts 和 ArkUI Image/动画/V2 卡片；可见回调用比例而非方向判断 |
| 图标 | 无新增系统符号；现有返回/搜索/箭头保持 |
| 颜色 | 现有 themePalette 已核实；品牌渐变源于 web/src/components/brand/loopi.tsx，封装为 SVG |
| 架构 | view → common/service；无反向业务依赖 |
| 复用 | 已有加载圈没有表情，故需新建角色；复用系统减少动态及前后台回调 |
| 灰度 | 无业务逻辑改变，不需要开关 |

### 11.6 一致性
§3–9 与调研范围一致；无接口/数据/布局未决冲突。

## 12. 设计版本
v1.0 / 2026-10-03：以当前 `web/src/components/brand/loopi.tsx` 和 `loopi-motion.ts` 为视觉源，原生分层实现，不引入独立设计稿。
