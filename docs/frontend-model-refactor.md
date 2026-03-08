# 前端模型页面重构方案

## 现状分析

### 问题诊断

1. **SettingsPage.ts 过于庞大** (2000+ 行)
   - 包含 providers、models、channels、gateway 等多个功能
   - 逻辑混杂，难以维护

2. **数据结构不匹配**
   ```typescript
   // 前端还在使用旧结构
   config.models.providers[providerId] = { apiKey, models: [...] }
   
   // 后端已经简化为
   config.providers[providerId] = apiKey
   ```

3. **硬编码模型列表**
   ```typescript
   // src/channels/telegram/command-handler.ts
   const DEFAULT_MODELS: Record<string, string[]> = {
     openai: ['gpt-4o', 'gpt-4o-mini', ...],
     anthropic: ['claude-sonnet-4-5', ...],
     // ... 22 个 provider 都需要维护
   }
   ```
   这与后端的动态模型获取冲突

4. **Provider API Key 硬编码**
   ```typescript
   // SettingsPage.ts 中每个 provider 一个字段
   openaiApiKey: '',
   anthropicApiKey: '',
   googleApiKey: '',
   // ... 需要为每个 provider 添加
   ```

5. **数据转换层过多**
   - `registry-client.ts` 中 RegistryProvider → ProviderTemplate → ModelConfig
   - 多层转换增加复杂度和出错可能

## 重构方案

### 目标
1. 与后端简化后的架构对齐
2. 删除所有硬编码的模型/provider 数据
3. 完全依赖后端 API 获取模型信息
4. 简化前端代码，提高可维护性

### 实施计划

#### Phase 1: 创建统一的 Provider 配置组件

**新文件: `ui/src/components/ProviderConfig.ts`**

```typescript
// 简化的 Provider 配置组件
// 只处理单个 provider 的 API key 配置

@customElement('provider-config')
export class ProviderConfig extends LitElement {
  @property() provider!: string;  // 'openai', 'anthropic', etc.
  @property() apiKey: string = '';
  @property() configured: boolean = false;
  
  // 从 providers/index.ts 获取显示名称
  private get displayName(): string {
    return getProviderDisplayName(this.provider);
  }
  
  // 从 providers/index.ts 获取是否支持 OAuth
  private get supportsOAuth(): boolean {
    return providerSupportsOAuth(this.provider);
  }
  
  render() {
    return html`
      <div class="provider-item ${this.configured ? 'configured' : ''}">
        <div class="provider-header">
          <span class="provider-name">${this.displayName}</span>
          ${this.configured 
            ? html`<span class="badge success">✓ Configured</span>` 
            : html`<span class="badge">Not configured</span>`
          }
        </div>
        <div class="provider-input">
          <input 
            type="password" 
            .value=${this.apiKey}
            placeholder="sk-..."
            @change=${this._onApiKeyChange}
          />
          ${this.supportsOAuth ? html`
            <button @click=${this._onOAuthLogin}>OAuth Login</button>
          ` : ''}
        </div>
      </div>
    `;
  }
}
```

#### Phase 2: 重构模型选择器

**新文件: `ui/src/components/ModelSelector.ts`**

```typescript
// 简化的模型选择器
// 只从后端 API 获取模型列表

@customElement('model-selector')
export class ModelSelector extends LitElement {
  @property() value: string = '';  // 当前选中的模型 ID
  @property() filter?: string;      // 可选过滤条件
  
  @state() private _models: Array<{
    id: string;
    name: string;
    provider: string;
    reasoning?: boolean;
    vision?: boolean;
  }> = [];
  
  @state() private _loading = false;
  
  async connectedCallback() {
    super.connectedCallback();
    await this._loadModels();
  }
  
  private async _loadModels() {
    this._loading = true;
    try {
      // 调用 /api/models 获取已配置的模型
      const response = await fetch('/api/models');
      const data = await response.json();
      this._models = data.payload.models;
    } finally {
      this._loading = false;
    }
  }
  
  render() {
    if (this._loading) return html`<span>Loading...</span>`;
    
    return html`
      <select .value=${this.value} @change=${this._onChange}>
        ${this._models.map(m => html`
          <option value=${m.id}>
            ${m.provider}/${m.name}
            ${m.reasoning ? '🧠' : ''}
            ${m.vision ? '📷' : ''}
          </option>
        `)}
      </select>
    `;
  }
}
```

#### Phase 3: 简化 SettingsPage

**重写后的 `SettingsPage.ts`** (约 500 行)

```typescript
@customElement('settings-page')
export class SettingsPage extends LitElement {
  @property() config?: SettingsPageConfig;
  
  @state() private _values: SettingsValue = {
    model: '',           // 默认模型
    workspace: '',
    maxTokens: 8192,
    temperature: 0.7,
    providers: {},       // 简化为 { [providerId]: apiKey }
    telegramEnabled: false,
    // ... 其他设置
  };
  
  @state() private _providers: string[] = [];  // 从后端获取的 provider 列表
  
  // 加载设置
  private async _loadSettings() {
    const [configRes, providersRes] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/providers'),  // 获取所有可用 provider
    ]);
    
    const config = (await configRes.json()).payload.config;
    const providers = (await providersRes.json()).payload.models
      .map((m: any) => m.provider)
      .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);  // unique
    
    this._values = {
      model: config.agents?.defaults?.model || DEFAULT_MODEL,
      workspace: config.agents?.defaults?.workspace || '',
      providers: config.providers || {},  // 新的扁平结构
      // ...
    };
    
    this._providers = providers;
  }
  
  // 渲染 Provider 配置部分
  private _renderProvidersSection() {
    return html`
      <div class="providers-section">
        <p class="hint">Configure API keys for the providers you want to use.</p>
        
        ${this._providers.map(providerId => html`
          <provider-config
            .provider=${providerId}
            .apiKey=${this._values.providers[providerId] || ''}
            .configured=${!!this._values.providers[providerId]}
            @change=${(e: CustomEvent) => this._onProviderChange(providerId, e.detail.apiKey)}
          ></provider-config>
        `)}
      </div>
    `;
  }
  
  // 保存设置
  private async _saveSettings() {
    const updates = {
      agents: {
        defaults: {
          model: this._values.model,
          workspace: this._values.workspace,
          maxTokens: this._values.maxTokens,
          temperature: this._values.temperature,
        }
      },
      providers: this._values.providers,  // 简化为扁平结构
      // ... 其他设置
    };
    
    await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  }
}
```

#### Phase 4: 更新 API 客户端

**简化 `registry-client.ts`**

```typescript
// 删除复杂的类型转换，直接使用后端 API 格式

export interface Model {
  id: string;           // "provider/modelId"
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  vision: boolean;
  cost: { input: number; output: number };
  available: boolean;   // 是否已配置 API key
}

export interface Provider {
  id: string;
  name: string;
  configured: boolean;
  supportsOAuth: boolean;
  models: Model[];
}

// 获取所有模型（包含未配置的）
export async function fetchAllModels(token?: string): Promise<Model[]> {
  const res = await fetch('/api/providers', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  return data.payload.models;
}

// 获取已配置的模型
export async function fetchConfiguredModels(token?: string): Promise<Model[]> {
  const res = await fetch('/api/models', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  return data.payload.models;
}

// 删除不再需要的类型转换函数
// - toProviderTemplates (删除)
// - fetchRegistry (简化)
```

#### Phase 5: 删除硬编码数据

**删除以下文件中的硬编码数据:**

1. `src/channels/telegram/command-handler.ts`
   - 删除 `DEFAULT_MODELS`
   - 删除 `PROVIDER_NAMES`
   - 使用 `getProviderDisplayName()` 和 `getModelsByProvider()`

2. `src/cli/commands/onboard.ts`
   - 删除本地的 `providerMeta`
   - 使用 `PROVIDER_META` 从 providers/index.ts

3. `ui/src/pages/SettingsPage.ts`
   - 删除硬编码的 API key 字段列表
   - 动态生成 provider 配置 UI

### API 变更

#### 当前 API (保持不变)

```
GET /api/models
Response: { models: [{ id, name, provider, contextWindow, maxTokens, reasoning, vision, cost }] }

GET /api/providers  
Response: { models: [{ id, name, provider, ..., available }] }

GET /api/registry
Response: { providers: [{ id, name, configured, models: [...] }] }

PATCH /api/config
Request: { providers: { [providerId]: apiKey } }  // 新的扁平格式
```

### 文件变更计划

```
ui/src/
├── components/
│   ├── ProviderConfig.ts          # 新增: 单个 provider 配置组件
│   ├── ModelSelector.ts           # 新增: 模型选择器组件
│   └── ProviderList.ts            # 新增: provider 列表组件
├── config/
│   └── registry-client.ts         # 简化: 删除类型转换
├── pages/
│   ├── SettingsPage.ts            # 重写: 从 2000 行简化到 ~500 行
│   └── CronManager.ts             # 修改: 使用新的 ModelSelector
└── utils/
    └── provider-meta.ts           # 删除: 合并到 registry-client
```

### 实施顺序

1. **Phase 1**: 创建新的基础组件 (ProviderConfig, ModelSelector)
2. **Phase 2**: 重写 SettingsPage，使用新组件
3. **Phase 3**: 简化 registry-client，删除类型转换
4. **Phase 4**: 更新 CronManager 使用新的 ModelSelector
5. **Phase 5**: 清理删除硬编码数据
6. **Phase 6**: 测试验证

### 预期收益

| 指标 | 当前 | 目标 |
|------|------|------|
| SettingsPage.ts 行数 | ~2000 行 | ~500 行 |
| 硬编码 provider 数量 | 8 个固定 | 动态从后端获取 (22+) |
| 硬编码模型数量 | ~60 个 | 0 (从 pi-ai 动态获取) |
| 数据转换层数 | 3 层 | 1 层 |
| 添加新 provider 工作量 | 修改 3+ 文件 | 0 (自动支持) |

### 风险与缓解

1. **向后兼容性**: 旧版 config 格式的迁移
   - 缓解: 后端 API 保持兼容，前端只处理新格式

2. **UI 体验**: Provider 列表可能很长 (22 个)
   - 缓解: 按分类折叠 (common/specialty/enterprise/oauth)

3. **OAuth 流程**: 需要保留 OAuth 登录支持
   - 缓解: ProviderConfig 组件内置 OAuth 按钮
