# Gateway 实施计划

1. 扩展 realtime ticket 契约，要求显式 `protocolVersion`。
2. Gateway 在签发 ticket 前返回定向 426 错误。
3. 公共 Realtime Client 校验 ticket 协议并抛出不可重试错误。
4. 更新所有调用方与定向测试。
5. 自审错误模型、重试边界和权限范围。
