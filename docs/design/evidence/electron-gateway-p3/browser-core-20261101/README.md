# P3d Browser 专用契约与协调核心

当前是内部实现阶段，不声明网络/Main/安装包 Browser 能力已开放。既有 browser.control/recording 的契约、确认和并发不变；新契约位于独立包子路径 @xopcai/browser-control-contract/remote，默认旧入口不引入新实现。

- 新 desktop.browser.control 复用既有 Browser 单个动作，但显式绑定 owner/session/actionId；目标设备由认证端点决定，不能在参数中替换endpoint、携带服务器绝对路径或原始脚本。输入不接受upload/sequence，批次必须在上层拆为逐次批准的动作；文件通过独立的授权工作区/传输能力。
- 单个调用30秒、单并发、逐次本机确认、前台要求、独立browser-control权限；旧owner endpoint不能冒充独立Desktop执行权。Agent通用工具发现/描述/原始执行均排除专用Browser传输。
- Browser协调器只在Supervisor持久journal之后创建惰性Broker；限制单一conversation owner/当前session，prepare屏障之后才执行。未知结果关闭Broker并保留unknown，停止未确认不能作为停止成功。观察图像只能通过调用绑定的5MiB内存帧上传，JSON拒绝内嵌图像，回传后及异常/迟到帧清零。
- 已有Browser扩展、BrowserRuntime/ExtensionDriver回归不变。新增传输使用memory-frame及invocationId，为后续网络接线准备；此阶段无设备grant/Host/Main/BrowserWindow入口，不能依据核心测试宣称Browser E2E通过。

64项核心/策略/越权/既有Browser回归通过，日志 `/tmp/xopc-p3d-browser-core-regression-2.log`。全量根目录和Electron类型检查通过，日志 `/tmp/xopc-p3d-browser-core-typecheck-2.log`。

失败保留：初轮测试缺失Supervisor signal参数，修正夹具；初轮类型检查修正BrowserControlResult的联合类型判别；regression-1两项错误地把Session独立停止当成journal已经持久确认，修正为先保留unknown，再由Supervisor独立停止核实后断言executionStopped。不改生产未知/停止判定，也不提高预算。

下一步：独立Browser grant与签名Host专用调用/上传、Gateway显式设备路由、Main独立partition的原生Browser Broker和逐次批准，再执行真实HTTP/WSS及安装包故障验收。
