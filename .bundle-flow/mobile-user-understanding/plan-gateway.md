# 实施计划：Gateway

1. 在 gateway-contract 增加移动用户理解 DTO、筛选和分页 schema，并导出。
2. 为 `/api/user-model` 与 `/api/knowledge-memory` 建立 `workspace.read/write` 权限映射。
3. 增加移动概览接口；扩展 assertions 列表为向后兼容的移动分页视图。
4. 覆盖 scope、summary、filter、cursor、limit、修改与删除回归测试。
5. 运行 gateway-contract 与 user-model 路由测试及根 typecheck。
