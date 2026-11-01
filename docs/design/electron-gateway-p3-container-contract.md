# P3c 本机 Docker 命令与 PTY 契约

2026-11-01 用户明确接受本机Docker隔离后端。现有本地模式的shell/PTY保持原路径。远端模式新增独立容器执行授权，不从设备登记、剪贴板或本机目录授权推导。

## 执行与数据边界

Main仅连接本机Unix socket，忽略DOCKER_HOST和远端上下文，要求Docker Engine身份固定。不把Docker API、socket、任意容器ID、挂载选项、主机环境变量或凭据交给Renderer/Agent。不自动拉取镜像；用户原生确认已安装镜像的不可变image ID、独立容器工作区和有效期。

首版工作区为Docker管理的专用卷，不自动挂载用户电脑目录；文件交换仍需显式授权。每个命令使用独立容器和稳定operationId，卷在该工作区内延续。容器使用非root、只读根文件系统、无网络、无主机绑定、cap-drop ALL、no-new-privileges及CPU/内存/PID/输出限制；只能使用镜像内的程序。Docker隔离依赖本机Engine与内核，不能宣称抵抗所有内核漏洞。参数依据[Docker容器创建接口](https://docs.docker.com/reference/cli/docker/container/create/)和[Engine安全边界](https://docs.docker.com/engine/security/)核对。

命令是结构化argv，不能作为Docker参数解释。PTY另用有序字节流、输入/resize、背压、结束与断开协议，不用普通工具progress冒充终端流。服务器默认shell仍在服务器运行。

## 持久记录与停止证明

执行前持久保存已绑定意图的本机加密资源元数据。先记录创建意图，再创建容器；获取不可变CID后必须持久化，再发送start。禁止把create和start合并成不可核实的一次run，也不在网络错误后自动重发start。

停止时删除精确CID并核实同一Engine上该CID不存在，以阻止尚在途中的start和遗留子进程。只杀HTTP客户端、命令PID退出、docker stop已发送或容器看似not-running均不作为充分证明。Main崩溃后，原running意图转unknown；新执行必须先核实对应容器已销毁。Engine不可达/身份变化/资源身份不符时保持停止未确认与执行权阻断，不能用人工勾选替代停止证明。

卷的文件副作用可能已经发生。清理容器不将旧结果改成成功或失败；人工核实后只能授权新的意图，不能重做旧operationId。未知记录与对应卷保留供检查，不自动删除。临时卷清理需与不确定结果、PTY退出和生命周期分别核实。

## 验收顺序

1. 本机socket适配器与资源边界：真实Engine固定身份、无本机挂载/网络/凭据继承、非root写入专用卷、输出/PID/内存限额，首次失败保留。
2. 稳定资源记录与命令监督：create/start各处丢回执、取消、超时、Main崩溃、daemon不可达/替换，拒绝自动重试，原停止预算不变。
3. 独立设备授权与签名调用、原生逐次批准、真实Agent/安装包与本地回归。
4. PTY有序流、重连不重放输入、背压、容器销毁和卷保留；再接显式文件交换与P4后台期限。

这是实施契约，尚不表示命令或PTY已开放或验收通过。

## 保留工作区与重新授权

专用卷的身份以系统安全存储加密保存在Main固定状态目录，按profileId、Gateway ID、origin、公钥完整绑定隔离。记录仅表示数据位置，不表示授权；列表向Renderer仅返回workspaceId、显示名称和不可变镜像ID。每次重新访问都需要新设备执行授权和原生确认，旧grant、operationId与终端字节流不得恢复。

重新访问必须核实原Engine、镜像和卷标签；卷不存在时报错，不自动创建同名空卷。新建授权取消不写入记录或创建卷。未知操作保留原卷供人工核实，新授权不覆盖旧unknown。目前最多保存20项，不自动淘汰；显式卷管理及总磁盘配额仍须补齐。已有CPU、内存、PID、日志和输出限额不能替代总磁盘配额。

## PTY独立生命周期

PTY打开回执只证明会话已建立。根操作在容器存在期间保持running，字节流、输入接收回执和WebSocket关闭均不能证明执行器停止。每次会话绑定sessionId、generation、connectionInstanceId；新连接不恢复旧会话，不重放stdin。输入先持久保存不含明文的身份/摘要，再写入socket；丢回执、部分写入或待确认记录均阻止自动重放。

输出使用独立有序帧和累计ACK，最多16个未确认帧、每帧16KiB，暂停底层流处理背压。输入每帧最多4KiB、每会话最多1000个序号；这些是新增终端流限制，不放宽Endpoint原预算。超时、授权失效、传输断开或输出不确定时，独立销毁容器并核实；停止失败保留执行权阻断。完整Gateway/Host/Agent/UI接线与原生验收另行完成，不能以字节流核心测试代替。

通道在Endpoint v2上以显式协商的`terminal.version=1`扩展复用签名设备连接：`terminal.command`承载input/ack/resize/close，`terminal.event`承载opened/output/input-ack/stream-ended。每个包保留根invocationId与完整会话三元组；不能使用tool.progress代替字节流。opened只能表示running/未停止，input-ack仅表示输入分派，stream-ended不能携带停止证明。根操作仍由原可靠tool回执核实停止。旧普通/可靠控制器明确拒绝terminal.command；Gateway在专用Broker未接线时拒绝terminal.event，不因schema认识字段就开放功能。Terminal hello仅允许独立durable desktop连接声明。

P3c-3接线采用独立`desktop.terminal.open`与`desktop.terminal.control`目录，和命令目录分开原生授权。Root操作先持久记录，打开响应返回后仍保持running，输入/输出使用专用帧；Agent调用不会因收到opened而提交根操作成功。每次stdin均须本机批准，取消也持久记为notStarted并消耗该输入序号，重试不再写入。输入接收仅表示分派，不代表shell命令完成。

resize须回传对应requestId/尺寸的签名ACK；输出按字节序号有界排队，一次读取最多16KiB，累计ACK只确认已取出的帧，并提供跨帧UTF-8解码文本。根操作正常关闭先独立核实容器删除，再提交生命周期终态；强制终止不伪造进程退出码，以terminated标志和可空exitCode表达。它不承诺终端中每条shell输入的文件效果都成功。断连/未知输入仍走unknown和人工核实；后续本机停止证明不会改写服务器旧unknown。Root和控制操作分别持久化幂等记录，关闭、切换或重连不恢复旧会话。

本批仅复用已有Gateway认证/设备/Endpoint路径，未增加认证路由。60秒单次输入确认沿用容器命令预算，仍受两分钟原生总授权约束；停止/关闭保持3秒确认预算。完整Native整轮和安装包故障验证通过前，不将接线完成等同于P3c整体验收完成。
