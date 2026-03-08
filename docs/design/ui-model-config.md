# UI 模型配置设计方案

## 当前架构分析

### 后端配置结构
```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "provider-id": {
        "baseUrl": "https://api.example.com/v1",
        "api": "openai-completions",
        "apiKey": "sk-...",
        "models": [
          {
            "id": "model-id",
            "name": "Model Name",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0 },
            "contextWindow": 128000,
            "maxTokens": 4096
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "provider/model-id" },
      "imageModel": { "primary": "provider/image-model-id" }
    }
  }
}
```

### 当前 UI 限制
1. 模型选择是下拉框，只显示后端返回的模型列表
2. 无法添加自定义模型
3. 无法配置图片模型
4. Providers 部分只配置 API Key，不配置具体模型

## 设计方案

### 方案 A: 扩展现有 Providers Section（推荐）

将 Providers section 改为可展开/折叠的 Provider 卡片，每个 Provider 包含：

1. **Provider 基本信息**
   - Provider ID（只读或新建时输入）
   - Base URL
   - API 类型（OpenAI、Anthropic、Google 等）
   - API Key

2. **模型列表管理**
   - 显示当前 Provider 下的所有模型
   - 添加自定义模型按钮
   - 删除模型按钮

3. **自定义模型配置表单**
   - Model ID
   - Model Name（显示名称）
   - 能力标签（文本、图片、推理）
   - Context Window
   - Max Tokens
   - Cost（可选）

### 方案 B: 独立的 Models Section

新增一个 Models section，专门管理所有模型：

1. **模型列表视图**
   - 分组显示（按 Provider）
   - 搜索/筛选
   - 添加/编辑/删除

2. **模型编辑表单**
   - 选择 Provider（或创建新 Provider）
   - 填写模型详细信息

3. **图片模型专门配置**
   - 单独的区域配置 imageModel.primary

## UI 设计建议

### 1. Providers Section 重构

```
┌─────────────────────────────────────────────┐
│ Providers                           [+添加] │
├─────────────────────────────────────────────┤
│ ▼ OpenAI                                    │
│   Base URL: https://api.openai.com/v1       │
│   API Key: •••••••• [显示] [删除]           │
│                                             │
│   Models:                                   │
│   ┌─────────────────────────────────────┐   │
│   │ gpt-4o        文本+图片  [编辑][×]  │   │
│   │ gpt-4o-mini   文本      [编辑][×]  │   │
│   │ [+ 添加自定义模型]                  │   │
│   └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│ ▶ Anthropic                                 │
├─────────────────────────────────────────────┤
│ ▶ 自定义 Provider...                        │
└─────────────────────────────────────────────┘
```

### 2. 添加/编辑模型弹窗

```
┌───────────────────────────────┐
│ 添加自定义模型        [×]     │
├───────────────────────────────┤
│ Provider: OpenAI ▼            │
│                               │
│ Model ID: [gpt-4-custom]      │
│ Name:     [GPT-4 Custom]      │
│                               │
│ 能力:                         │
│ ☑ 文本  ☑ 图片  ☑ 推理       │
│                               │
│ Context Window: [128000]      │
│ Max Tokens:     [4096]        │
│                               │
│ Cost (per 1M tokens):         │
│ Input:  [5.00]  Output: [15.00]│
│                               │
│        [取消]    [保存]       │
└───────────────────────────────┘
```

### 3. Agent Section 增强

在 Agent section 中添加图片模型选择：

```
┌─────────────────────────────────────┐
│ Agent                               │
├─────────────────────────────────────┤
│                                     │
│ 主模型:                             │
│ [OpenAI/gpt-4o          ▼]         │
│                                     │
│ 图片模型:                           │
│ [OpenAI/gpt-4o-vision   ▼]         │
│                                     │
│ ...其他配置                         │
└─────────────────────────────────────┘
```

## 数据结构建议

### 前端状态扩展
```typescript
interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  capabilities: {
    text: boolean;
    image: boolean;
    reasoning: boolean;
  };
  contextWindow: number;
  maxTokens: number;
  cost?: {
    input: number;
    output: number;
  };
}

interface ProviderConfig {
  id: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  models: ModelConfig[];
}
```

### API 接口建议
```typescript
// GET /api/providers - 获取所有 provider 配置
// POST /api/providers - 创建新 provider
// PATCH /api/providers/:id - 更新 provider
// DELETE /api/providers/:id - 删除 provider

// GET /api/providers/:id/models - 获取 provider 的模型
// POST /api/providers/:id/models - 添加模型
// PATCH /api/providers/:id/models/:modelId - 更新模型
// DELETE /api/providers/:id/models/:modelId - 删除模型
```

## 实现优先级

### Phase 1: 基础模型管理 ✅ 已完成
1. 重构 Providers section 为可展开卡片
2. 添加自定义模型表单
3. 支持添加/删除模型
4. Agent section 添加 imageModel 选择器

### Phase 2: Provider 管理 ✅ 已完成
1. 添加 Provider 创建功能
2. 添加 Provider 删除功能（带确认对话框）
3. 支持选择 API 类型（OpenAI、Anthropic、Google、Ollama 等）

### Phase 3: 高级功能 🔄 待实施
1. 模型搜索/筛选
2. 批量导入/导出
3. 模型能力自动检测（通过 API）
4. Provider/Model 拖拽排序
5. 模型使用统计展示

## 技术实现建议

1. **组件拆分**
   - `ProviderCard` - Provider 展开卡片
   - `ModelList` - 模型列表
   - `ModelForm` - 模型添加/编辑表单
   - `ImageModelSelector` - 图片模型选择器

2. **状态管理**
   - 使用现有的 `_values` 状态
   - 添加 `providers` 和 `models` 状态

3. **向后兼容**
   - 保持现有 API Key 配置方式
   - 迁移时自动创建默认 Provider
