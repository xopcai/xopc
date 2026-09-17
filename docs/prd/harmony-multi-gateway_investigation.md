# 鸿蒙多 Gateway 调研

状态：用户已确认方案与本地工具验证路径；已实现，设备验收待完成。
日期：2026-09-18

## 1. 需求背景

以 apps/mobile-expo 的现有实现为交互和行为基准，让鸿蒙保存多个 Gateway，并切换当前活动 Gateway。不是同时聚合多个 Gateway 的聊天和任务。

## 2. 涉及模块

- Expo 参考：src/stores/gateway-store.ts、gateway-types.ts，src/features/gateway/GatewayListScreen.tsx、gateway-switch-service.ts。
- 鸿蒙连接：entry/src/main/ets/service/gatewaySession.ets、model/gateway.ets、viewmodel/connectionViewModel.ets。
- 鸿蒙入口：pages/Index.ets、view/HomeView.ets、PersonalView.ets、SettingsView.ets、ChatDrawer.ets。
- 联动：realtimeClient、聊天草稿、页面 ViewModel、文件传输、推送及通知导航。

## 3. 现有能力盘点

- Expo 已有 profiles + activeGatewayId，支持保存、重命名、移除及激活；切换验证 /api/status，失败回退，并有并发尝试序号。
- 鸿蒙已有 HTTPS 路由校验、Gateway 身份验证、刷新令牌轮换日志、请求 generation 防护，可以扩展而不重写协议。
- 鸿蒙仍使用单份 profile、refresh、refresh-attempt；disconnect 会清除设备密钥，不能用作切换操作。
- 已有扫码和手工邀请链接入口，应复用，添加 Gateway 不能要求先移除旧连接。
- 工程 oh-package.json5 无运行时第三方依赖；当前方案优先复用现有服务，不引入新库。

## 4. 历史相关变更

当前工作区有主线程尚未提交的聊天、HomeView、国际化资源及测试变更。本侧对话未修改这些文件；后续接入需逐处确认最新差异。

## 5. 架构约束与风险

- 凭据和刷新重试日志须按 Gateway 隔离，避免认证发送到其他 Gateway。
- 切换需要失效旧异步响应，重置 WebSocket 和游标，清理旧页面选择及缓存，保留独立草稿。
- 移除一个 Gateway 不得删除其他 Gateway 仍依赖的设备密钥。
- 旧单连接迁移应可重复、保留配对，不清空应用数据。
- 推送、通知点击、下载和语音仍须继续盘点跨 Gateway 边界，不能仅靠重建 UI 判断隔离完成。

## 6. 初步方案方向

推荐：保存多份配置、一个活动连接，沿用 Expo 的切换验证与失败回退。设置页提供管理，聊天抽屉提供快捷切换。

不推荐：仅替换 URL，无法保证凭据与页面隔离；同时连接并聚合多个 Gateway 超出本次对齐范围。

## 7. 待方案论证的问题

请确认按 Expo 基准交付：多份配置、单活动连接；添加、切换、重命名、移除；旧配对无损迁移；手机布局优先。UI 以现有 Expo 源码为依据，不另创设计。

## 8. 方案论证结论

用户确认采用 Expo 的多配置、单活动连接模式，并明确要求使用本地 hvigor/CodeLinter/hdc，不配置全局 MCP。

## 9. 已记录问题

已实现；尚未执行真机双 Gateway 验收。主线程已有修改保持不变，chatMedia 仅追加本需求的跨连接校验；源码发现工具不可用，本轮使用本地检索。

## 10. 现有交互行为清单

| 文件 | 现有行为 | 改造约束 |
|---|---|---|
| Index.ets | connected 决定展示主页还是扫码/手工配对页，含等待确认、取消和错误态 | 添加第二个 Gateway 时独立展示配对流程，退出不能丢失原连接 |
| connectionViewModel.ets | restore/connect 后启动 realtime，失败时恢复 currentProfile | 引入切换事务，避免旧连接和新配对状态混用 |
| HomeView.ets | 主 Chat、四 Tab、导航栈及通知入口 | 切换后清理旧 Gateway 页面；保留主线程的键盘和导航修复 |
| PersonalView.ets | 连接行显示当前名称，进入 connection 设置 | 改为管理多份 Gateway 的入口，显示活动项 |
| gatewaySession.ets | 单份存储；disconnect 删除 profile、refresh、轮换日志和设备密钥 | 分离激活、移除、取消配对与完全清除的语义 |

验收重点：A/B 往返、重启恢复、B 离线回退、取消添加、重复添加、移除非活动/活动/最后一项、刷新与切换竞争、旧响应不污染新页面、旧安装迁移。
