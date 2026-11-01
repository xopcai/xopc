# P3d Browser 独立设备网络接线

内部网络阶段完成，不声明已开放Main原生Browser窗口或完整Browser安装包验收。

- 独立desktop.browser.control grant只可搭配操作状态查询，不能混用Computer、clipboard、workspace或container。旧Browser扩展凭据/策略与原Computer grant不变。
- 使用独立设备凭据、P256签名HTTP/WSS、desktop.browser.v1协商和精确grant/revision。Host必须注入专用Browser协调器，不能落入通用执行器；原入口未注入时不会创建Browser。
- 调用复用既有external-operation持久意图，owner/session/actionId稳定去重、参数变更冲突、断线unknown不重放。派发前重核当前设备/Gateway/连接实例/执行权；没有独立执行权时不回退服务器或旧Browser endpoint。
- PNG/JPEG帧复用既有5MiB单文件内存上传服务、固定路径和invocationId交接。设备证明绑定上传正文/token；Browser/Computer不能交叉使用彼此grant，图片不进入普通磁盘下载区，撤销后拒绝。
- 原设备截图与Computer上传调用保留原校验/错误码；新增私有共用实现避免复制认证逻辑。没有新增认证路由，不需要新增lazy-bundle匹配；测试通过真实认证HTTP入口。

真实签名HTTP/WSS正常与已签名结果丢失两场景通过：本机已持久结果且停止确认、Gateway仍unknown、不重复效果。Broker/原生批准在该测试中注入，不冒称真实浏览器DOM输入或Native批准。日志 `/tmp/xopc-p3d-browser-host-e2e-1.log` 和 `/tmp/xopc-p3d-browser-host-regression-1.log`；后者42通过、1个既有条件跳过。

独立PNG/JPEG真实HTTP上传及旧Computer边界、专用控制器非法grant/撤销/重复调用验证通过。434项相关回归通过、6项既有条件跳过（74文件），440项packages测试通过；集合重叠，不与历史次数相加。日志 `/tmp/xopc-p3d-browser-network-regression-1.log`、`/tmp/xopc-p3d-browser-network-packages-1.log`、`/tmp/xopc-p3d-browser-controller-tests-1.log`。全类型检查 `/tmp/xopc-p3d-browser-controller-typecheck-3.log` 通过。

首轮upload-controller测试的grant参数化夹具漏改标题导致tool未定义，失败日志-1保留；仅修正夹具后-2通过。原30秒调用、3秒停止、2分钟授权及S0预算未提高；旧失败不覆盖。

下一步补Main拥有的Browser执行器恢复元数据、显式设备路由、独立partition/原生批准和真实安装包正常/故障验收。目前不宣称P3d、P4或最终main交付完成。
