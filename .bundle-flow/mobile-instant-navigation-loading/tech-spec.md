# 技术方案：移动端即时导航与缓存优先加载

> Plan ID: `mobile-instant-navigation-loading`
> 状态: confirmed
> 涉及平台: HarmonyOS、Android、iOS

## 目标

- 首页 Chat 进入时先展示本地会话历史，再并行校验网络数据。
- 点击对话、笔记、任务、项目、自动化、用户理解、文件、工作流和 Agent 等列表项后，先完成路由或详情态切换，不让旧列表停留等待接口。
- 列表首次加载保留骨架屏；详情首次加载统一使用 xopc Logo 品牌动画，避免页面语义混乱。
- 加载动画支持减少动态效果和无障碍加载说明。

## 方案

### Chat

HarmonyOS 将 `cachedHistory` 从网络对账之后提前到 `open()` 开始处启动。缓存读取与草稿对账、网络恢复并行，网络结果仍为权威数据；选择代次和 `hasNetworkHistory` 防止过期缓存覆盖新会话。Expo 继续使用 MMKV 保存的会话选择与 `useSessionHistory.initialData`，无需新增请求或模型调用。

### 列表到详情

- HarmonyOS ViewModel 在请求前同步设置 `openingId`，视图立即进入详情加载态；完成、失败、返回或销毁时清理并以 generation 防止过期响应回写。
- Expo Router 原有 `router.push` 已同步进入目标路由，详情页把首屏骨架/Spinner 统一替换为 `BrandLoadingState`。
- 文件对象本地已存在时直接预览，不额外制造加载；深链需要请求资源时展示品牌加载态。

### 视觉与可访问性

- HarmonyOS 复用品牌底图与强调层，强调层匀速旋转；Chat 运行态使用 20vp 紧凑版本，页面加载使用 42vp 版本。
- Expo 使用现有 `XopcLogo` 做低幅呼吸动画，监听系统 Reduce Motion；加载容器声明 progressbar 和本地化标签。

## 验证标准

1. 有历史缓存时，Chat 不因网络对账显示空白。
2. 详情点击后的首帧已是目标页 Header 与品牌加载态。
3. 缓存延迟不阻塞网络恢复，旧请求不能覆盖新选择。
4. Expo typecheck、lint、定向测试通过；HarmonyOS ArkTS/HAP 构建和回归测试通过。
