# 技术方案：移动端与 Gateway 版本兼容

> 状态：confirmed

## 范围

实现最小且明确的版本兼容闭环：移动端在申请 realtime ticket 时提交自身协议版本；Gateway 判断是客户端过旧还是 Gateway 过旧；移动端停止无意义重试并展示定向提示。普通商店新版检测、OTA、多协议并存、远程策略中心不在本次范围。

## 通用契约

- 当前只支持一个 realtime 协议版本，遵循 KISS，不引入兼容矩阵。
- `clientProtocolVersion < gatewayProtocolVersion`：`CLIENT_UPDATE_REQUIRED`。
- `clientProtocolVersion > gatewayProtocolVersion`：`GATEWAY_UPDATE_REQUIRED`。
- 相等时正常签发 ticket。
- 两种不兼容错误均不可重试，HTTP 状态为 426。
- 非 mobile 客户端继续使用共享 realtime client 的既有协议常量；所有调用方均显式提交协议版本，不保留缺省兼容分支。

## 产品行为

- Android/iOS：连接状态保存结构化不兼容原因，显示阻断提示；客户端过旧提供应用发布页入口，Gateway 过旧提示在 Gateway 管理端更新。
- HarmonyOS：移除硬编码应用版本和模糊 `protocol_incompatible`，分别显示更新 App / 更新 Gateway。
- 离线、未授权和版本不兼容保持独立状态。

## 上线与应急

先发布支持结构化错误的 Gateway 与客户端，再提高协议版本。监控两类 426 错误和重复连接次数；异常时保持协议版本不变即可回滚，不需要兼容分支。
