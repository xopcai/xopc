# P3e 有界文本快照与显式回传

复用现有已认证files API，无新增Gateway路由/SQL版本。本机缓存按profileId、gatewayId和公钥隔离，正文/草稿/上传状态用OS safeStorage加密；原生确认后先持久化uploading，再发送一次版本化PUT。冲突保留草稿；超时、切换或回执丢失为unknown，恢复不重发。当前支持会话工作区根目录的32 KiB以内UTF-8可编辑文本。缓存上限20份，不静默删除；目录浏览扩展、缓存显式管理与P4大文件仍待补全，不能宣称所有文件能力完成。

## 安装包与结果

正式身份包 `/tmp/xopc-p3e-delivery-2/installed/xopc.app`，1431文件，摘要 `285ed514b6a5944d8f87b93afdd7c397f8dd91963b49140e2f7a1e3672924a2c`。原生副本 `/tmp/xopc-p3e-delivery-2/native/xopc.app`，摘要 `a4e2e9cdaf1354f68be4d1b4e695d7428ef19d7c8308303421e18c7f74e4b4e2`；只更改测试bundle ID与主Mach-O签名。DMG摘要 `a0a0962a417103a9f369007899e9cd744ec6ba101c2989f68e0a09fa21358017`。这是非公证阶段包，尚非最终main交付。

- `p3e-native-remote-files-2.json` 真实原生取消/批准回传、版本冲突、实际服务器已写入后丢响应、禁用重发、缓存密文与跨Gateway命名空间隔离均通过。随后同轮远端聊天/网络/gap/进程重启/Worker崩溃恢复和真实本地重启通过，包摘要不变。第1轮同样通过，但未加入后续新增缓存密文/命名空间断言，保留原报告。
- `p3e-installed-local-1.json` 正式身份包本地spawn/旧schema266 Gateway复用、聊天、Cookie、Realtime、原有文件/PTY/browser IPC、owned重启和外部Gateway存活均通过。
- 真实认证Hono/lazy-route HTTP E2E通过：无凭据拒绝、固定Gateway身份、下载、原生批准注入取消零请求、实际版本PUT、冲突和服务端变更后模拟丢回执不重试。此测试用注入批准/夹具加密，不替代上述真实原生测试。
- 160项相关回归、40项子集及新增授权边界/恢复测试通过，完整类型检查通过；集合重叠不相加。

## 失败与限制

首次核心测试暴露存储包装器的提前return，导致缓存未落盘；4项失败完整保留，修复后通过。第1次产物构建期间编辑界面仍在完成，第2次重建后才作为本批验收对象。文件读取在内容前后复核资源版本，拒绝下载期间变化；现有Gateway版本化PUT不宣称与外部编辑器全局原子互斥。

锁屏、切换和停止取消文件生命周期；取消消息绕过网络工作队列，已发出的服务器操作无法核实则保持unknown。新IPC只接受当前Shell精确main frame；不开放任意本机路径、host-path、任意上游URL或通用IPC。性能原预算、旧失败与S5长测保持不变。Docker命令/PTY、专用Browser/Computer及P4仍在后续实施范围。
