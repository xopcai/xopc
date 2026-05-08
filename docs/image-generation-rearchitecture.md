# 图像生成（Image Generation）架构重构方案

> 目标：把 xopc 现有「内核内置三家 Provider + 静态 import 注册」的图像生成实现，迁移到「内核空 + 插件契约 + 注册表」的架构，全面对齐 [openclaw](https://github.com/openclawai/openclaw) 在 `src/image-generation/` 与 `src/media-generation/` 的设计，并为后续的 **视频 / 音乐生成** 预留共享基础设施。

- **状态**：Draft v0
- **作者**：xopc core
- **范围**：`src/agent/image/generation/`、`src/agent/tools/image-generate-tool.ts`、`src/extensions/`、`src/config/`、`web/src/features/settings/`
- **预估工作量**：4 个迭代（每个 ~1 周），见 [§14 分阶段迁移路径](#14-分阶段迁移路径)
- **不影响**：`src/agent/image/understanding/`（pi-ai 多模态）、文本 LLM 调用链

---

## 目录

- [1. 现状基线（As-Is）](#1-现状基线as-is)
- [2. 目标架构（To-Be）总览](#2-目标架构to-be总览)
- [3. 模块清单与目录树](#3-模块清单与目录树)
- [4. 核心类型与契约（types.ts）](#4-核心类型与契约typests)
- [5. 能力建模（capabilities）](#5-能力建模capabilities)
- [6. 参数归一化（normalization）](#6-参数归一化normalization)
- [7. HTTP 底盘（provider-http）](#7-http-底盘provider-http)
- [8. 鉴权层（provider-auth）](#8-鉴权层provider-auth)
- [9. 容错与可观测（failover + logger）](#9-容错与可观测failover--logger)
- [10. 插件机制与 Provider 注册](#10-插件机制与-provider-注册)
- [11. 三家 Provider 落地 + Google/Fal 蓝图](#11-三家-provider-落地--googlefal-蓝图)
- [12. 工具层 image_generate](#12-工具层-image_generate)
- [13. 配置 Schema 与 Web UI 适配](#13-配置-schema-与-web-ui-适配)
- [14. 分阶段迁移路径](#14-分阶段迁移路径)
- [15. 兼容性、回滚、测试矩阵、风险](#15-兼容性回滚测试矩阵风险)
- [附录 A：openclaw 关键文件索引](#附录-aopenclaw-关键文件索引)
- [附录 B：xopc 当前可复用基础](#附录-bxopc-当前可复用基础)

---

## 1. 现状基线（As-Is）

> 后续章节会详细展开，本节只做"指出当前长什么样、痛点在哪"。详见 [docs/models.md](./models.md) 与对应源码。

### 1.1 现有结构

```
src/agent/image/
├── generation/
│   ├── runtime.ts                # generateImage()，硬编码候选解析
│   ├── provider-registry.ts      # 静态 Map，模块加载即 register
│   ├── types.ts                  # 极简 capabilities：supportsEdit / maxInputImages
│   ├── constants.ts              # OPENAI_DEFAULT_IMAGE_MODEL / DASHSCOPE_DEFAULT_IMAGE_MODEL / MINIMAX_DEFAULT_IMAGE_MODEL
│   ├── openai-generate.ts        # 自己写 fetch + AbortSignal.any，~190 行
│   ├── dashscope-generate.ts     # 三个区域 endpoint 写死、size 字符串映射
│   ├── minimax-generate.ts       # aspect_ratio 最近邻匹配
│   └── __tests__/...
├── image-helpers.ts              # applyImageGenerationModelConfigDefaults 等
├── image-model-fallback.ts       # runWithImageModelFallback（理解侧）
├── tool-model-config.ts          # ToolModelConfig
└── index.ts                      # barrel
```

### 1.2 痛点

| # | 痛点 | 影响 |
|---|------|------|
| P1 | Provider 内置在内核，加新厂商必须改 `runtime.ts` 的 `import` 副作用 | 扩展性差，与 channels 的 plugin 模型不一致 |
| P2 | `capabilities` 扁平、布尔型 | 无法表达 generate 与 edit 不同能力、aspectRatio/resolution/quality/format/background 等维度 |
| P3 | 每家 Provider 各自手写 `fetch + setTimeout + AbortSignal.any` | 没有统一 SSRF 保护、超时策略、multipart helper、Azure 兼容、OAuth 路由 |
| P4 | 不支持的参数直接 `throw`（如 DashScope 收到 `inputImages`） | 上层无法降级为"忽略并提示" |
| P5 | 错误聚合是字符串拼接 `'All image generation models failed (...)'` | UI/Log Manager 拿不到 status/code/reason，无法重试决策 |
| P6 | 鉴权只有 `getApiKey(providerId)` | 不支持 per-agent OAuth profile、Codex `responses` API 路由 |
| P7 | 没有 media 通用层 | 视频/音乐生成将必须重复抄一份 candidate 解析、normalization、错误聚合 |

---

## 2. 目标架构（To-Be）总览

```
                        ┌────────────────────────────────────────────────┐
                        │                AgentService                    │
                        │  src/agent/tools/image-generate-tool.ts        │
                        └───────────────┬────────────────────────────────┘
                                        │ generateImage(GenerateImageParams)
                        ┌───────────────▼────────────────────────────────┐
                        │   src/agent/image/generation/runtime.ts         │
                        │   - resolveCapabilityModelCandidates()          │
                        │   - 逐个 provider 尝试 + Failover 收敛           │
                        │   - 写入 attempts/normalization/metadata        │
                        └───────────────┬────────────────────────────────┘
                                        │
              ┌─────────────────────────┴────────────────────────────────┐
              │   src/agent/image/generation/provider-registry.ts        │
              │   - listImageGenerationProviders(cfg)                    │
              │   - getImageGenerationProvider(id, cfg) + aliases        │
              │   - 内核 BUILTIN 列表 = []，全部走 plugin 注入             │
              └─────────────────────────┬────────────────────────────────┘
                                        │ resolvePluginCapabilityProviders()
              ┌─────────────────────────▼────────────────────────────────┐
              │   src/extensions/loader.ts → ExtensionApi.registerImage…  │
              └─────────────────────────┬────────────────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────────┐
        │                               │                                   │
┌───────▼────────────┐     ┌────────────▼─────────────┐     ┌───────────────▼────────────┐
│ extensions/openai/ │     │ extensions/dashscope/    │     │ extensions/minimax/        │
│ image-generation-  │     │ image-generation-        │     │ image-generation-          │
│ provider.ts        │     │ provider.ts              │     │ provider.ts                │
│                    │     │                          │     │                            │
│ 复用：              │     │ 复用：                    │     │ 复用：                      │
│ - openai-compat    │     │ - provider-http          │     │ - provider-http            │
│   image factory    │     │ - provider-auth          │     │ - provider-auth            │
│ - provider-http    │     │ - normalization          │     │ - normalization            │
└──────┬─────────────┘     └────────────┬─────────────┘     └────────────┬───────────────┘
       │                                │                                │
       └────────────────────────────────┼────────────────────────────────┘
                                        │
                ┌───────────────────────▼───────────────────────┐
                │  src/agent/image/generation/                  │
                │  ├── openai-compatible-image-provider.ts      │  ← 工厂
                │  ├── normalization.ts                         │  ← size↔aspectRatio↔resolution
                │  ├── image-assets.ts                          │  ← b64/dataUrl/sniff
                │  ├── model-ref.ts                             │
                │  └── runtime-types.ts                         │
                ├───────────────────────────────────────────────┤
                │  src/agent/media-generation/runtime-shared.ts │  ← 图像/视频/音乐共享
                │  - resolveCapabilityModelCandidates           │
                │  - resolveClosestSize/AspectRatio/Resolution  │
                │  - throwCapabilityGenerationFailure           │
                ├───────────────────────────────────────────────┤
                │  src/providers/http/        (provider-http)   │  ← 抽象 fetch 层
                │  src/providers/auth-runtime/(provider-auth)   │  ← AuthProfileStore
                │  src/agent/failover-error.ts (新增)            │  ← FailoverError
                └───────────────────────────────────────────────┘
```

> **核心思想**：内核只定义"图像生成的契约"（types + registry + runtime + 共享 helpers），不绑定任何厂商；每家厂商以扩展形式落在 `extensions/<vendor>/image-generation-provider.ts`，通过 `xopc.bundledImageGenerationProvider` 字段被 `scripts/generate-bundled-image-providers.mjs` 收集到 `src/generated/bundled-image-generation-providers.ts`，运行时由 `ExtensionLoader` 注入 registry。

---

## 3. 模块清单与目录树

> 详细类型签名见 [§4](#4-核心类型与契约typests)；本节只列**新增/改造/删除**的文件。

```
src/
├── agent/
│   ├── image/
│   │   ├── generation/
│   │   │   ├── runtime.ts                  [改造] 复用 media-generation/runtime-shared
│   │   │   ├── runtime-types.ts            [新增] GenerateImageParams/Result 拆出
│   │   │   ├── types.ts                    [改造] capabilities 拆 generate/edit/geometry/output
│   │   │   ├── provider-registry.ts        [改造] 内核空 + 插件枚举 + aliases
│   │   │   ├── normalization.ts            [新增] resolveImageGenerationOverrides
│   │   │   ├── image-assets.ts             [新增] b64/dataUrl/sniff helper
│   │   │   ├── model-ref.ts                [新增] parseImageGenerationModelRef
│   │   │   ├── openai-compatible-image-provider.ts [新增] 工厂
│   │   │   ├── constants.ts                [保留] DEFAULT 常量
│   │   │   ├── openai-generate.ts          [删除] → extensions/openai/
│   │   │   ├── dashscope-generate.ts       [删除] → extensions/dashscope/
│   │   │   ├── minimax-generate.ts         [删除] → extensions/minimax/
│   │   │   └── __tests__/                  [改造] 单测随之迁移
│   │   ├── image-helpers.ts                [保留]
│   │   ├── image-model-fallback.ts         [保留] understanding 侧仍在用
│   │   ├── tool-model-config.ts            [保留]
│   │   └── index.ts                        [改造] 导出新 API
│   ├── media-generation/                   [新增目录]
│   │   ├── runtime-shared.ts               [新增] 跨能力共享
│   │   ├── normalization.types.ts          [新增] MediaNormalizationEntry
│   │   ├── model-ref.ts                    [新增] parseGenerationModelRef
│   │   └── __tests__/
│   ├── failover-error.ts                   [新增] FailoverError + isFailoverError
│   └── tools/
│       ├── image-generate-tool.ts          [改造] 接受新参数 + 回灌 metadata
│       └── factory.ts                      [改造] 注入新工具
├── providers/
│   ├── index.ts                            [保留]
│   ├── env-keys.ts                         [保留]
│   ├── http/                               [新增目录] provider-http 抽象
│   │   ├── index.ts
│   │   ├── post-json-request.ts
│   │   ├── post-multipart-request.ts
│   │   ├── resolve-provider-http-request-config.ts
│   │   ├── assert-ok.ts
│   │   ├── deadline.ts
│   │   └── __tests__/
│   └── auth-runtime/                       [新增目录] provider-auth-runtime
│       ├── index.ts
│       ├── resolve-api-key-for-provider.ts
│       ├── auth-profile-store.ts           [可选] 后续 OAuth 用
│       └── __tests__/
├── extensions/
│   ├── types/
│   │   └── core.ts                         [改造] ExtensionApi 加 registerImageGenerationProvider
│   ├── sdk/
│   │   └── provider.ts                     [改造] 暴露 ImageGenerationProvider helper
│   ├── loader.ts                           [改造] 注入插件到 image-generation registry
│   └── slots.ts                            [保留] imageGeneration slot 仍可用作 UI 展示
├── generated/
│   ├── bundled-channel-plugins.ts          [保留]
│   └── bundled-image-generation-providers.ts [新增] 由脚本生成
├── config/
│   └── schema.ts                           [改造] 加 imageGenerationModel.timeoutMs 等
└── gateway/
    └── hono/routes/
        ├── models.ts                       [改造] /api/image/providers
        └── config.ts                       [改造] PATCH 接受新字段

scripts/
├── generate-bundled-channel-plugins.mjs    [保留]
└── generate-bundled-image-providers.mjs    [新增] 类似机制扫描 xopc.bundledImageGenerationProvider

extensions/
├── openai/
│   ├── package.json                        [新增 xopc.bundledImageGenerationProvider]
│   └── image-generation-provider.ts        [新增]
├── dashscope/                              [新增目录]
│   ├── package.json
│   └── image-generation-provider.ts
├── minimax/                                [新增目录]
│   ├── package.json
│   └── image-generation-provider.ts
└── (后续) google/, fal/

web/
└── src/features/settings/
    ├── config-api.ts                       [改造] 加新字段
    ├── provider-enrichment.ts              [改造] 三家 + Google/Fal 入口
    └── pages/models-page.tsx               [改造] 图像 Provider 选择器
```

---

## 4. 核心类型与契约（types.ts）

> 见 `src/agent/image/generation/types.ts`（改造）。本节给完整签名；**实现细节**见 [§6 normalization](#6-参数归一化normalization) 与 [§10 注册表](#10-插件机制与-provider-注册)。

### 4.1 资产与请求

```typescript
// src/agent/image/generation/types.ts

import type { Config } from '../../../config/schema.js';
import type { AuthProfileStore } from '../../../providers/auth-runtime/auth-profile-store.js';
import type { MediaNormalizationEntry } from '../../media-generation/normalization.types.js';

/** 单张产出图。openclaw 对齐：types.ts:GeneratedImageAsset。 */
export type GeneratedImageAsset = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  /** 服务端可能返回的 prompt 改写（OpenAI dall-e-3 / gpt-image-1 会带）。 */
  revisedPrompt?: string;
  /** 厂商私有元数据（如 nodeId/promptId），不参与 LLM context。 */
  metadata?: Record<string, unknown>;
};

/** 入参（来自工具 / CLI / Web）。 */
export type ImageGenerationSourceImage = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
};

export type ImageGenerationResolution = '1K' | '2K' | '4K';
export type ImageGenerationQuality = 'low' | 'medium' | 'high' | 'auto';
export type ImageGenerationOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageGenerationBackground = 'transparent' | 'opaque' | 'auto';

/** 厂商专属 options（typed escape hatch，不进入归一化流程）。 */
export type ImageGenerationOpenAIOptions = {
  background?: ImageGenerationBackground;
  moderation?: 'low' | 'auto';
  outputCompression?: number;
  user?: string;
};
export type ImageGenerationProviderOptions = {
  openai?: ImageGenerationOpenAIOptions;
  // 后续：dashscope?/minimax?/google?/fal?
};

/** Provider 收到的最终请求（已经过归一化）。 */
export type ImageGenerationRequest = {
  provider: string;
  model: string;
  prompt: string;
  cfg: Config;
  agentDir?: string;
  authStore?: AuthProfileStore;
  timeoutMs?: number;
  count?: number;
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  background?: ImageGenerationBackground;
  inputImages?: ImageGenerationSourceImage[];
  providerOptions?: ImageGenerationProviderOptions;
};

/** Provider 返回。 */
export type ImageGenerationResult = {
  images: GeneratedImageAsset[];
  model?: string;
  metadata?: Record<string, unknown>;
};
```

### 4.2 Provider 契约

```typescript
export type ImageGenerationProviderConfiguredContext = {
  cfg?: Config;
  agentDir?: string;
};

export interface ImageGenerationProvider {
  /** Provider id（小写，registry key）。 */
  id: string;
  /** 别名（如 OpenAI 同时映射 'openai-codex'）。 */
  aliases?: string[];
  label?: string;
  defaultModel?: string;
  models?: string[];
  capabilities: ImageGenerationProviderCapabilities;   // 见 §5
  isConfigured?: (ctx: ImageGenerationProviderConfiguredContext) => boolean;
  generateImage: (req: ImageGenerationRequest) => Promise<ImageGenerationResult>;
}
```

> **变更**：相比当前 xopc 版本，`isConfigured` 由 `() => Promise<boolean>` 改为 **同步**（与 openclaw 对齐），方便 `listProviders(cfg)` 在 UI / CLI 内同步过滤。

### 4.3 Runtime 入口

```typescript
// src/agent/image/generation/runtime-types.ts
import type { FallbackAttempt } from '../../failover-error.js';

export type GenerateImageParams = {
  cfg: Config;                    // ← 由 optional 改为必填
  prompt: string;
  agentDir?: string;
  authStore?: AuthProfileStore;
  modelOverride?: string;
  count?: number;
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  background?: ImageGenerationBackground;
  inputImages?: ImageGenerationSourceImage[];
  /** 当 candidates 跑完仍失败时，是否枚举所有 isConfigured() 的 provider 兜底。 */
  autoProviderFallback?: boolean;
  timeoutMs?: number;
  providerOptions?: ImageGenerationProviderOptions;
};

export type GenerateImageRuntimeResult = {
  images: GeneratedImageAsset[];
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
  normalization?: ImageGenerationNormalization;          // 见 §6
  metadata?: Record<string, unknown>;
  ignoredOverrides: ImageGenerationIgnoredOverride[];    // 见 §6
};
```

```typescript
// src/agent/image/generation/runtime.ts
export async function generateImage(
  params: GenerateImageParams,
  deps?: ImageGenerationRuntimeDeps,
): Promise<GenerateImageRuntimeResult>;

export function listRuntimeImageGenerationProviders(
  params?: { config?: Config },
  deps?: ImageGenerationRuntimeDeps,
): ImageGenerationProvider[];

export type ImageGenerationRuntimeDeps = {
  getProvider?: typeof getImageGenerationProvider;
  listProviders?: typeof listImageGenerationProviders;
  getProviderEnvVars?: (id: string) => string[];
  log?: { warn(msg: string): void };
};
```

> **依赖注入**：`deps` 参数让单测可以注入 mock provider，避免依赖 `process.env`。openclaw 在 `runtime.ts` 顶部就这么做。

---

## 5. 能力建模（capabilities）

> 把"能不能做、能在什么尺寸/格式下做"从 Provider 内部抽到结构体，归一化层 / UI / 工具 schema 都依赖这套结构。

### 5.1 类型定义

```typescript
// src/agent/image/generation/types.ts (续)

/** 单一模式（generate 或 edit）的几何能力。 */
export type ImageGenerationModeCapabilities = {
  maxCount?: number;
  supportsSize?: boolean;
  supportsAspectRatio?: boolean;
  supportsResolution?: boolean;
};

/** 编辑能力额外要求 enabled + 最大输入图数。 */
export type ImageGenerationEditCapabilities = ImageGenerationModeCapabilities & {
  enabled: boolean;
  maxInputImages?: number;
};

/** 几何 enum 列表（用于归一化时找最近邻）。 */
export type ImageGenerationGeometryCapabilities = {
  sizes?: string[];                          // ['1024x1024', '1536x1024', ...]
  aspectRatios?: string[];                   // ['1:1', '16:9', '9:16', ...]
  resolutions?: ImageGenerationResolution[]; // ['1K', '2K', '4K']
};

/** 输出特性 enum 列表。 */
export type ImageGenerationOutputCapabilities = {
  qualities?: ImageGenerationQuality[];
  formats?: ImageGenerationOutputFormat[];
  backgrounds?: ImageGenerationBackground[];
};

export type ImageGenerationProviderCapabilities = {
  generate: ImageGenerationModeCapabilities;
  edit: ImageGenerationEditCapabilities;
  geometry?: ImageGenerationGeometryCapabilities;
  output?: ImageGenerationOutputCapabilities;
};
```

### 5.2 三家 Provider 能力对照表（迁移后）

| 维度 | OpenAI (`gpt-image-1`) | DashScope (`wan2.6-t2i`) | MiniMax (`image-01`) |
|---|---|---|---|
| `generate.maxCount` | 4 | 4 | 9 |
| `generate.supportsSize` | true | true（`宽*高`） | false |
| `generate.supportsAspectRatio` | false | false | **true** |
| `generate.supportsResolution` | false | false | false |
| `edit.enabled` | **true** | false | true |
| `edit.maxInputImages` | 1 | — | 1 |
| `geometry.sizes` | `['1024x1024','1024x1536','1536x1024']` | `['1024x1024','1280x1280','1664x928',...]` | — |
| `geometry.aspectRatios` | — | — | `['1:1','16:9','4:3','3:2','2:3','3:4','9:16','21:9']` |
| `output.qualities` | `['low','medium','high','auto']` | — | — |
| `output.formats` | `['png','jpeg','webp']` | — | — |
| `output.backgrounds` | `['transparent','opaque','auto']` | — | — |

### 5.3 设计原则

- **不要在 Provider 实现里"暗藏"能力分支**。所有"我支持 / 我不支持"必须出现在 `capabilities` 里，让上层 normalization 决定怎么转换。
- **`maxCount` 由 capabilities 控**。运行时 `Math.min(req.count ?? 1, capabilities.generate.maxCount ?? 1)`，避免超额请求。
- **不要把 `1:1`、`16:9` 这种 aspectRatio 塞进 `geometry.sizes`**。Size 指像素尺寸（`1024x1024`），AspectRatio 是抽象比例（`'16:9'`）。

---

## 6. 参数归一化（normalization）

> openclaw 对齐：`src/image-generation/normalization.ts:resolveImageGenerationOverrides`。

### 6.1 输出类型

```typescript
// src/agent/image/generation/types.ts (续)

export type ImageGenerationIgnoredOverride = {
  key: 'size' | 'aspectRatio' | 'resolution' | 'quality' | 'outputFormat' | 'background';
  value: string;
};

export type ImageGenerationNormalization = {
  size?: MediaNormalizationEntry<string>;
  aspectRatio?: MediaNormalizationEntry<string>;
  resolution?: MediaNormalizationEntry<ImageGenerationResolution>;
};
```

```typescript
// src/agent/media-generation/normalization.types.ts

export type MediaNormalizationValue = string | number;

export type MediaNormalizationEntry<TValue extends MediaNormalizationValue> = {
  /** 用户原始请求值。 */
  requested?: TValue;
  /** 实际下发给 Provider 的值。 */
  applied?: TValue;
  /** 当 applied 是从其他字段推导出来时，注明来源（如 size→aspectRatio）。 */
  derivedFrom?: 'size' | 'aspectRatio' | 'resolution';
  /** Provider 列出的支持值，便于 UI 展示提示。 */
  supportedValues?: TValue[];
};
```

### 6.2 解析函数签名

```typescript
// src/agent/image/generation/normalization.ts

export function resolveImageGenerationOverrides(params: {
  provider: ImageGenerationProvider;
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  background?: ImageGenerationBackground;
  inputImages?: ImageGenerationSourceImage[];
}): {
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  background?: ImageGenerationBackground;
  ignoredOverrides: ImageGenerationIgnoredOverride[];
  normalization?: ImageGenerationNormalization;
};
```

### 6.3 决策表（核心）

| 用户输入 | Provider 能力 | 行为 |
|---|---|---|
| `size='1024x768'` | 支持 size，但 `geometry.sizes=['1024x1024','1024x1536']` | 找最近邻（按面积+长宽比加权），输出 `applied='1024x1024'`，记录 `requested` |
| `size='1024x768'` | **不支持** size 但支持 aspectRatio | 派生出 `aspectRatio='4:3'`（按 `geometry.aspectRatios` 找最近邻），记 `derivedFrom='size'` |
| `size='1024x768'` | 既不支持 size 也不支持 aspectRatio | 进 `ignoredOverrides`，不报错 |
| `aspectRatio='16:9'` | 支持 aspectRatio + 列表内 | 直传 |
| `aspectRatio='16:9'` | 仅支持 size | 反推 `size='1536x864'`（按 `geometry.sizes` 找最近邻）记 `derivedFrom='aspectRatio'` |
| `resolution='4K'` | 支持但只到 `2K` | 取 `2K`，记 `requested='4K' applied='2K'` |
| `quality='ultra'` | `output.qualities` 不含 | 进 `ignoredOverrides` |
| `inputImages=[...]` | `edit.enabled=false` | 抛错 `'<provider> image editing is not supported.'`（这是硬错） |
| `inputImages.length > edit.maxInputImages` | 编辑模式 | 抛错 |

### 6.4 共享 helpers（在 media-generation 层）

```typescript
// src/agent/media-generation/runtime-shared.ts

export function resolveClosestSize(params: {
  requestedSize?: string;
  requestedAspectRatio?: string;
  supportedSizes?: string[];
}): string | undefined;

export function resolveClosestAspectRatio(params: {
  requestedAspectRatio?: string;
  requestedSize?: string;
  supportedAspectRatios?: string[];
}): string | undefined;

export function resolveClosestResolution(params: {
  requestedResolution?: ImageGenerationResolution;
  supportedResolutions?: ImageGenerationResolution[];
}): ImageGenerationResolution | undefined;

export function hasMediaNormalizationEntry<T extends MediaNormalizationValue>(
  entry: MediaNormalizationEntry<T> | undefined,
): entry is MediaNormalizationEntry<T>;
```

> 这些函数图像 / 视频 / 音乐 / 后续 3D 生成都会复用，是 [§14 Step 4](#14-分阶段迁移路径) 里"为视频/音乐铺路"的核心。

### 6.5 metadata 回灌

`runtime.ts` 在调用完 Provider 后，会把 normalization 信息写到 `metadata.normalization` 中：

```typescript
metadata: {
  ...result.metadata,
  ...buildMediaGenerationNormalizationMetadata({
    normalization: sanitized.normalization,
    requestedSizeForDerivedAspectRatio: params.size,
  }),
}
```

工具层据此可以告诉用户：「你要的 1024x768 被映射为 1:1 输出」（见 [§12.4](#124-用户提示与-metadata-展示)）。

---

## 7. HTTP 底盘（provider-http）

> openclaw 对齐：`openclaw/plugin-sdk/provider-http`。xopc 落点：`src/providers/http/`。
> 目标：把每个 Provider 文件里手写的 `fetch + setTimeout + AbortSignal.any` 全部收敛到一处，并补齐 SSRF 防护、Azure 兼容路径、multipart helper。

### 7.1 模块切分

```
src/providers/http/
├── index.ts                                 # barrel
├── deadline.ts                              # 超时聚合：createProviderOperationDeadline / resolveProviderOperationTimeoutMs
├── resolve-provider-http-request-config.ts  # baseUrl/headers/SSRF/dispatcher 一次解析
├── post-json-request.ts                     # JSON 请求
├── post-multipart-request.ts                # multipart 请求（image edit 用）
├── assert-ok.ts                             # 把非 2xx 响应转成结构化错误
├── sanitize-configured-request.ts           # 过滤用户配置的 request 选项
├── private-network.ts                       # SSRF 判断（127.0.0.1 / ::1 / 169.254 / 私网段）
└── __tests__/
```

### 7.2 关键签名

```typescript
// src/providers/http/resolve-provider-http-request-config.ts

export type ProviderHttpRequestConfig = {
  baseUrl: string;
  allowPrivateNetwork: boolean;
  headers: Headers;                          // 可变（multipart 时会移除 Content-Type）
  dispatcherPolicy?: DispatcherPolicy;       // undici dispatcher（仅 Node）
};

export function resolveProviderHttpRequestConfig(params: {
  baseUrl: string | undefined;
  defaultBaseUrl: string;
  allowPrivateNetwork?: boolean;
  defaultHeaders?: Record<string, string>;
  request?: SanitizedProviderRequestOptions; // 用户配置的 timeout/headers（已过滤）
  provider: string;
  capability: 'image' | 'video' | 'music' | 'llm';
  transport: 'http';
}): ProviderHttpRequestConfig;
```

```typescript
// src/providers/http/post-json-request.ts

export type ProviderHttpRequest = {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  allowPrivateNetwork: boolean;
  dispatcherPolicy?: DispatcherPolicy;
};

export type ProviderHttpResponse = {
  response: Response;
  /** 释放底层资源（如 dispatcher、timeout）。 */
  release: () => Promise<void>;
};

export function postJsonRequest(req: ProviderHttpRequest): Promise<ProviderHttpResponse>;
```

```typescript
// src/providers/http/post-multipart-request.ts

export function postMultipartRequest(req: Omit<ProviderHttpRequest, 'body'> & {
  body: FormData;
}): Promise<ProviderHttpResponse>;
```

```typescript
// src/providers/http/assert-ok.ts

/** 把 4xx/5xx 抹平成 FailoverError（见 §9）。 */
export function assertOkOrThrowHttpError(
  response: Response,
  label: string,
): Promise<void>;
```

```typescript
// src/providers/http/deadline.ts

export type ProviderOperationDeadline = {
  signal: AbortSignal;
  deadlineAtMs: number;
};

/** 把"用户传入 signal" + "我们追加的最大等待时长" + "label" 合并。 */
export function createProviderOperationDeadline(params: {
  timeoutMs?: number;
  label: string;
  externalSignal?: AbortSignal;
}): ProviderOperationDeadline;

/** 在 Provider 默认超时与剩余 deadline 之间取较小者。 */
export function resolveProviderOperationTimeoutMs(params: {
  deadline: ProviderOperationDeadline;
  defaultTimeoutMs: number;
}): number;
```

### 7.3 SSRF / 私网保护

```typescript
// src/providers/http/private-network.ts

export function isPrivateNetworkHost(hostname: string): boolean;

/** 默认 false；只有 cfg.browser.ssrfPolicy.allowPrivate === true 时才允许。 */
export function isPrivateNetworkOptInEnabled(
  policy: Config['browser']['ssrfPolicy'] | undefined,
): boolean;
```

> 触发逻辑：`resolveProviderHttpRequestConfig` 解析出 `baseUrl` 后，若 hostname 命中 `127.0.0.1 / localhost / ::1 / 169.254.0.0/16 / 10.x / 172.16-31.x / 192.168.x`，且 `allowPrivateNetwork=false`，发起请求前直接 throw；这与 `assertOkOrThrowHttpError` 之前发生。

### 7.4 OpenAI 兼容 image 工厂

> openclaw 对齐：`src/image-generation/openai-compatible-image-provider.ts:createOpenAiCompatibleImageGenerationProvider`。

```typescript
// src/agent/image/generation/openai-compatible-image-provider.ts

export type OpenAiCompatibleImageRequestMode = 'generate' | 'edit';

export type OpenAiCompatibleImageProviderRequestParams = {
  req: ImageGenerationRequest;
  inputImages: ImageGenerationSourceImage[];
  model: string;
  count: number;
  mode: OpenAiCompatibleImageRequestMode;
};

export type OpenAiCompatibleImageProviderRequestBody =
  | { kind: 'json'; body: Record<string, unknown> }
  | { kind: 'multipart'; form: FormData };

export type OpenAiCompatibleImageProviderOptions = {
  id: string;
  label: string;
  defaultModel: string;
  models: readonly string[];
  capabilities: ImageGenerationProviderCapabilities;
  defaultBaseUrl: string;
  /** 同名时 default 等于 id；不同时（如 azure-openai → 'openai'）显式给。 */
  providerConfigKey?: string;
  normalizeModel?: (model: string | undefined, fallback: string) => string;
  resolveBaseUrl?: (params: {
    req: ImageGenerationRequest;
    providerConfig?: ModelProviderConfig;
    defaultBaseUrl: string;
  }) => string;
  resolveAllowPrivateNetwork?: (params: {
    baseUrl: string;
    req: ImageGenerationRequest;
    providerConfig?: ModelProviderConfig;
  }) => boolean | undefined;
  useConfiguredRequest?: boolean;
  defaultTimeoutMs?: number;
  resolveCount?: (params: {
    req: ImageGenerationRequest;
    mode: OpenAiCompatibleImageRequestMode;
  }) => number;
  buildGenerateRequest: (
    params: OpenAiCompatibleImageProviderRequestParams & { mode: 'generate' },
  ) => OpenAiCompatibleImageProviderRequestBody;
  buildEditRequest: (
    params: OpenAiCompatibleImageProviderRequestParams & { mode: 'edit' },
  ) => OpenAiCompatibleImageProviderRequestBody;
  response?: {
    defaultMimeType?: string;
    fileNamePrefix?: string;
    sniffMimeType?: boolean;
  };
  missingApiKeyError?: string;
  tooManyInputImagesError?: string;
  missingInputImageError?: string;
  emptyResponseError?: string;
  failureLabels?: { generate?: string; edit?: string };
};

export function createOpenAiCompatibleImageGenerationProvider(
  options: OpenAiCompatibleImageProviderOptions,
): ImageGenerationProvider;
```

> **典型用法**（OpenRouter 等纯 OpenAI 兼容厂商）：

```typescript
buildOpenRouterImageProvider() = createOpenAiCompatibleImageGenerationProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  defaultModel: 'openai/gpt-image-1',
  models: ['openai/gpt-image-1', 'fal/flux-pro'],
  capabilities: { generate: { maxCount: 4, supportsSize: true }, edit: { enabled: false } },
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  buildGenerateRequest: ({ req, model, count }) => ({
    kind: 'json',
    body: { model, prompt: req.prompt, n: count, size: req.size, response_format: 'b64_json' },
  }),
  buildEditRequest: () => { throw new Error('OpenRouter image edit not supported'); },
});
```

OpenAI / Azure / Codex OAuth 这些**特殊鉴权或非 `/images` 路径**的复杂分支，仍然在 `extensions/openai/image-generation-provider.ts` 内手写（参考 [§11.1](#111-openai-extensionsopenaiimage-generation-providerts)），但所有 fetch 都走 `provider-http`。

### 7.5 Image asset helpers

```typescript
// src/agent/image/generation/image-assets.ts

export function imageFileExtensionForMimeType(
  mimeType: string | undefined,
  fallback?: string,
): string;

export function sniffImageMimeType(
  buffer: Buffer,
  fallbackMimeType?: string,
): { mimeType: string; extension: string };

export function toImageDataUrl(params: {
  buffer: Buffer;
  mimeType?: string;
  defaultMimeType?: string;
}): string;

export function parseImageDataUrl(
  dataUrl: string,
): { mimeType: string; base64: string } | undefined;

export function generatedImageAssetFromBase64(params: {
  base64: string | undefined;
  index: number;
  mimeType?: string;
  revisedPrompt?: string;
  defaultMimeType?: string;
  fileNamePrefix?: string;
  sniffMimeType?: boolean;
}): GeneratedImageAsset | undefined;

export type OpenAiCompatibleImageResponsePayload = {
  data?: Array<{ b64_json?: unknown; mime_type?: unknown; revised_prompt?: unknown }>;
};

export function parseOpenAiCompatibleImageResponse(
  payload: OpenAiCompatibleImageResponsePayload,
  options?: { defaultMimeType?: string; fileNamePrefix?: string; sniffMimeType?: boolean },
): GeneratedImageAsset[];
```

> 现有 xopc 实现里 base64→Buffer→fileName 的逻辑在三个文件里写了三遍，这里抽到一处。

---

## 8. 鉴权层（provider-auth）

> openclaw 对齐：`openclaw/plugin-sdk/provider-auth-runtime:resolveApiKeyForProvider`。
> xopc 落点：`src/providers/auth-runtime/`。

### 8.1 现状与差距

xopc 当前的鉴权抽象只有：

```typescript
// src/providers/index.ts
export async function getApiKey(provider: string): Promise<string | undefined>;
```

只能从 `cfg.providers[id]` 或 `process.env[ENV]` 取 key，**不支持**：

- per-agent 凭据（同一个 user 不同 agent 不同 key）
- OAuth profile / keychain（如 Codex OAuth、Anthropic OAuth）
- 多种鉴权方式同存（API key + OAuth），由 Provider 决定取哪个

### 8.2 新接口

```typescript
// src/providers/auth-runtime/index.ts

export type ProviderAuthMode = 'api-key' | 'oauth' | 'azure-key';

export type ProviderAuthResolution = {
  apiKey?: string;
  mode?: ProviderAuthMode;
  /** 选中的 profile id（OAuth/keychain 场景）。 */
  profileId?: string;
  /** Azure 等需要的 region/resource。 */
  azureResource?: string;
};

export function resolveApiKeyForProvider(params: {
  provider: string;
  cfg?: Config;
  agentDir?: string;
  store?: AuthProfileStore;
}): Promise<ProviderAuthResolution>;

/** 同步版本，仅检查"配置存在性"，不读取实际 key（用于 isConfigured）。 */
export function isProviderApiKeyConfigured(params: {
  provider: string;
  agentDir?: string;
}): boolean;
```

### 8.3 AuthProfileStore（可选 / 后续）

```typescript
// src/providers/auth-runtime/auth-profile-store.ts

export interface AuthProfileStore {
  list(provider: string): AuthProfile[];
  get(provider: string, profileId: string): AuthProfile | undefined;
  /** OAuth 场景：刷新 token，可能写回磁盘。 */
  refresh(profile: AuthProfile): Promise<AuthProfile>;
}

export type AuthProfile = {
  provider: string;
  profileId: string;
  mode: ProviderAuthMode;
  apiKey?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  expiresAt?: number;
  meta?: Record<string, unknown>;
};

/** 默认实现：~/.xopc/agents/<agentId>/auth-profiles.json，按需懒加载。 */
export function ensureAuthProfileStore(
  agentDir: string,
  options?: { allowKeychainPrompt?: boolean },
): AuthProfileStore;

export function listProfilesForProvider(
  store: AuthProfileStore,
  provider: string,
): AuthProfile[];
```

### 8.4 解析顺序（`resolveApiKeyForProvider`）

1. **`cfg.providers[provider].apiKey`**（显式优先级最高）
2. **AuthProfileStore**：若 `agentDir` 存在且该 provider 有 profile → 选择 `default` profile，必要时 `refresh()` token
3. **`PROVIDER_ENV_MAP[provider]` 命中的环境变量**（如 `OPENAI_API_KEY`、`DASHSCOPE_API_KEY`）
4. 都没有 → `apiKey: undefined`，由 Provider 决定是否走 alternative auth（如 Codex OAuth）或抛出 `'<label> API key missing'`

### 8.5 在 Provider 里的使用模式

```typescript
async generateImage(req) {
  const auth = await resolveApiKeyForProvider({
    provider: 'dashscope',
    cfg: req.cfg,
    agentDir: req.agentDir,
    store: req.authStore,
  });
  if (!auth.apiKey) {
    throw new Error('DashScope API key missing (set DASHSCOPE_API_KEY or providers.dashscope)');
  }
  const httpCfg = resolveProviderHttpRequestConfig({
    baseUrl: req.cfg?.providers?.dashscope?.baseUrl,
    defaultBaseUrl: DASHSCOPE_DEFAULT_BASE_URL,
    defaultHeaders: { Authorization: `Bearer ${auth.apiKey}` },
    provider: 'dashscope',
    capability: 'image',
    transport: 'http',
  });
  // …
}
```

### 8.6 `isConfigured` 同步实现

```typescript
isConfigured: ({ agentDir }) =>
  isProviderApiKeyConfigured({ provider: 'openai', agentDir }),
```

`isProviderApiKeyConfigured` 不会读 keychain（避免触发系统弹窗），仅检查 `cfg.providers[id].apiKey` 是否非空 + `PROVIDER_ENV_MAP[id]` 中任一环境变量是否设置 + AuthProfileStore 是否有 profile（仅检查存在性，不解锁）。

---

## 9. 容错与可观测（failover + logger）

> openclaw 对齐：`src/agents/failover-error.ts` + `src/media-generation/runtime-shared.ts:throwCapabilityGenerationFailure`。
> xopc 落点：`src/agent/failover-error.ts`（新增）+ `src/utils/logger.ts`（已存在，按规范使用）。

### 9.1 FailoverError 模型

```typescript
// src/agent/failover-error.ts

/** 触发 failover 的语义化原因（pi-embedded 既有定义可借鉴，xopc 这里只列必要项）。 */
export type FailoverReason =
  | 'auth'             // 401 / token 过期，可切下一家
  | 'auth_permanent'   // 403 / billing block，建议挂起此 provider
  | 'rate_limit'       // 429
  | 'overloaded'       // 503 / capacity
  | 'timeout'          // 408 / abort
  | 'model_not_found'  // 404 模型未上线
  | 'format'           // 400 请求格式错（不应 failover，仅记录）
  | 'billing'          // 402 余额不足
  | 'session_expired'  // 410
  | 'unknown';

export class FailoverError extends Error {
  readonly reason: FailoverReason;
  readonly provider?: string;
  readonly model?: string;
  readonly profileId?: string;
  readonly status?: number;
  readonly code?: string;
  readonly rawError?: string;
  readonly suspend?: boolean;  // 该 provider 本次 run 永远跳过

  constructor(message: string, params: {
    reason: FailoverReason;
    provider?: string;
    model?: string;
    profileId?: string;
    status?: number;
    code?: string;
    rawError?: string;
    cause?: unknown;
    suspend?: boolean;
  });
}

export function isFailoverError(err: unknown): err is FailoverError;

export function describeFailoverError(err: FailoverError): {
  message: string;
  reason: FailoverReason;
  status?: number;
  code?: string;
};

/** 由 status 反推默认 reason，供 assertOkOrThrowHttpError 使用。 */
export function reasonFromHttpStatus(status: number): FailoverReason;
```

### 9.2 attempts 结构（替换原本的字符串拼接）

```typescript
// src/agent/failover-error.ts （或者放到 media-generation）

export type FallbackAttempt = {
  provider: string;
  model: string;
  error: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
};

export function recordCapabilityCandidateFailure(params: {
  attempts: FallbackAttempt[];
  provider: string;
  model: string;
  error: unknown;
}): void;
```

### 9.3 候选解析与最终错误聚合

```typescript
// src/agent/media-generation/runtime-shared.ts

export type CapabilityProviderCandidate = {
  id: string;
  aliases?: readonly string[];
  defaultModel?: string | null;
  models?: readonly string[];
  isConfigured?: (ctx: { cfg?: Config; agentDir?: string }) => boolean;
};

/** 解析候选模型列表（含 modelOverride / primary / fallbacks / autoProviderFallback）。 */
export function resolveCapabilityModelCandidates(params: {
  cfg: Config;
  modelConfig: AgentModelConfig | undefined;
  modelOverride?: string;
  parseModelRef: (raw: string | undefined) => { provider: string; model: string } | null;
  agentDir?: string;
  listProviders: (cfg?: Config) => CapabilityProviderCandidate[];
  autoProviderFallback?: boolean;
}): Array<{ provider: string; model: string }>;

/** 当所有候选都跑完仍失败时，统一构造错误并抛出。 */
export function throwCapabilityGenerationFailure(params: {
  capabilityLabel: string;       // 'image generation'
  attempts: FallbackAttempt[];
  lastError: unknown;
}): never;

/** 当 candidates 列表本身就是空（用户没配） */
export function buildNoCapabilityModelConfiguredMessage(params: {
  capabilityLabel: string;       // 'image-generation'
  modelConfigKey: string;        // 'imageGenerationModel'
  providers: CapabilityProviderCandidate[];
  getProviderEnvVars?: (id: string) => string[];
}): string;
```

### 9.4 在 `runtime.ts` 中的串联

```typescript
// src/agent/image/generation/runtime.ts （摘要）
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('ImageGen');

export async function generateImage(params, deps = {}) {
  const candidates = resolveCapabilityModelCandidates({
    cfg: params.cfg,
    modelConfig: params.cfg.agents?.defaults?.imageGenerationModel,
    modelOverride: params.modelOverride,
    parseModelRef: parseImageGenerationModelRef,
    agentDir: params.agentDir,
    listProviders: deps.listProviders ?? listImageGenerationProviders,
    autoProviderFallback: params.autoProviderFallback,
  });
  if (candidates.length === 0) {
    throw new Error(buildNoImageGenerationModelConfiguredMessage(params.cfg, deps));
  }

  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (const candidate of candidates) {
    const provider = (deps.getProvider ?? getImageGenerationProvider)(candidate.provider, params.cfg);
    if (!provider) {
      const error = `No image-generation provider registered for ${candidate.provider}`;
      attempts.push({ provider: candidate.provider, model: candidate.model, error });
      lastError = new Error(error);
      log.warn({ provider: candidate.provider, model: candidate.model, phase: 'candidate_skipped' },
               `image-generation candidate skipped: ${error}`);
      continue;
    }

    try {
      const sanitized = resolveImageGenerationOverrides({ provider, ...overridesFromParams(params) });
      const result = await provider.generateImage({ ...buildRequest(params, candidate, sanitized) });
      if (!result.images?.length) throw new Error('Image generation provider returned no images.');
      return {
        images: result.images,
        provider: candidate.provider,
        model: result.model ?? candidate.model,
        attempts,
        normalization: sanitized.normalization,
        metadata: { ...result.metadata, ...buildNormalizationMetadata(sanitized, params) },
        ignoredOverrides: sanitized.ignoredOverrides,
      };
    } catch (err) {
      lastError = err;
      recordCapabilityCandidateFailure({ attempts, provider: candidate.provider, model: candidate.model, error: err });
      const described = isFailoverError(err) ? describeFailoverError(err) : undefined;
      log.warn(
        { err, provider: candidate.provider, model: candidate.model, status: described?.status, reason: described?.reason, phase: 'candidate_failed' },
        `image-generation candidate failed: ${candidate.provider}/${candidate.model}: ${described?.message ?? (err as Error).message}`,
      );
    }
  }

  return throwCapabilityGenerationFailure({ capabilityLabel: 'image generation', attempts, lastError });
}
```

### 9.5 Logger 规范（沿用 xopc `<logging_conventions>`）

| 字段 | 含义 |
|---|---|
| `phase` | `candidate_skipped` / `candidate_failed` / `provider_invoked` / `normalization_applied` |
| `provider` + `model` | 当前候选 |
| `status` / `reason` / `code` | 由 `describeFailoverError` 提取 |
| `requestId` | 通过 async log context 自动注入 |
| `attemptCount` | 已尝试次数 |
| `normalizationCount` | `Object.keys(sanitized.normalization ?? {}).length` |

不要在每次 candidate 失败时打 `error`；warn 即可。**最终全失败**时由调用方决定是否打 `error`（一般是 `image-generate-tool.ts` 的 catch 块）。

---

## 10. 插件机制与 Provider 注册

> 目标：完全复刻 openclaw 的"内核空 + 插件契约 + bundled 生成"机制，并复用 xopc 已有的 channel plugin 那一套基建。

### 10.1 插件落点与命名约定

```
extensions/<vendor>/
├── package.json                            # 含 xopc.bundledImageGenerationProvider
├── image-generation-provider.ts            # buildXxxImageGenerationProvider() 默认导出
├── index.ts                                # （可选）definePluginEntry 入口
└── __tests__/
    └── image-generation-provider.test.ts
```

`package.json` 新增字段：

```json
{
  "name": "@xopc/openai-extension",
  "private": true,
  "xopc": {
    "bundledChannel": null,
    "bundledImageGenerationProvider": {
      "module": "src/image-generation-provider.ts",
      "export": "buildOpenAIImageGenerationProvider",
      "order": 10
    }
  }
}
```

### 10.2 注册表（provider-registry.ts，改造后）

```typescript
// src/agent/image/generation/provider-registry.ts

import type { Config } from '../../../config/schema.js';
import type { ImageGenerationProvider } from './types.js';
import { resolvePluginCapabilityProviders } from '../../../extensions/capability-providers.js';

/** 内核内置 = 空。所有 provider 走插件注入（包括官方"自带"的三家）。 */
const BUILTIN_IMAGE_GENERATION_PROVIDERS: readonly ImageGenerationProvider[] = [];

const UNSAFE_PROVIDER_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeImageGenerationProviderId(id: string | undefined): string | undefined {
  const v = id?.trim().toLowerCase();
  if (!v || UNSAFE_PROVIDER_IDS.has(v)) {
    return undefined;
  }
  return v;
}

function buildProviderMaps(cfg?: Config): {
  canonical: Map<string, ImageGenerationProvider>;
  aliases: Map<string, ImageGenerationProvider>;
} {
  const canonical = new Map<string, ImageGenerationProvider>();
  const aliases = new Map<string, ImageGenerationProvider>();

  const register = (provider: ImageGenerationProvider) => {
    const id = normalizeImageGenerationProviderId(provider.id);
    if (!id) {
      return;
    }
    canonical.set(id, provider);
    aliases.set(id, provider);
    for (const alias of provider.aliases ?? []) {
      const a = normalizeImageGenerationProviderId(alias);
      if (a) {
        aliases.set(a, provider);
      }
    }
  };

  for (const p of BUILTIN_IMAGE_GENERATION_PROVIDERS) {
    register(p);
  }
  for (const p of resolvePluginCapabilityProviders<ImageGenerationProvider>({
    key: 'imageGenerationProviders',
    cfg,
  })) {
    register(p);
  }
  return { canonical, aliases };
}

export function listImageGenerationProviders(cfg?: Config): ImageGenerationProvider[] {
  return [...buildProviderMaps(cfg).canonical.values()];
}

export function getImageGenerationProvider(
  providerId: string | undefined,
  cfg?: Config,
): ImageGenerationProvider | undefined {
  const id = normalizeImageGenerationProviderId(providerId);
  if (!id) {
    return undefined;
  }
  return buildProviderMaps(cfg).aliases.get(id);
}

export function listImageGenerationProvidersSummary(cfg?: Config) {
  return listImageGenerationProviders(cfg).map((p) => ({
    id: p.id,
    label: p.label,
    defaultModel: p.defaultModel,
    models: p.models ?? (p.defaultModel ? [p.defaultModel] : []),
    capabilities: p.capabilities,
  }));
}
```

> 关键差异点：
> - **每次 `getProvider` / `listProviders` 都会重建 map**，因为 `cfg` 可能变（用户从 UI 切换 provider 启用状态）。如果发现性能问题，再加 `WeakMap<Config, ProviderMaps>` 缓存。
> - **`UNSAFE_PROVIDER_IDS`** 拦截 prototype pollution（与 openclaw 一致）。

### 10.3 ExtensionApi 扩展

```typescript
// src/extensions/types/core.ts (改造)

import type { ImageGenerationProvider } from '../../agent/image/generation/types.js';

export interface ExtensionApi {
  // ... 现有方法 ...

  /** 注册一个图像生成 Provider。 */
  registerImageGenerationProvider(provider: ImageGenerationProvider): void;
}

export type ExtensionKind =
  | 'channel'
  | 'provider'
  | 'memory'
  | 'tool'
  | 'utility'
  | 'tts'
  | 'image-generation'      // ← 已存在
  | 'web-search';
```

### 10.4 capability provider runtime（新增）

```typescript
// src/extensions/capability-providers.ts

import { getRegisteredCapabilityProviders } from './loader.js';
import type { Config } from '../config/schema.js';

export function resolvePluginCapabilityProviders<T>(params: {
  key: 'imageGenerationProviders' | 'videoGenerationProviders' | 'musicGenerationProviders';
  cfg?: Config;
}): T[] {
  const all = getRegisteredCapabilityProviders<T>(params.key);
  if (!params.cfg?.extensions) {
    return all;
  }
  // 按 cfg.extensions[id].enabled 过滤
  return all.filter((p) => isExtensionEnabled(params.cfg, (p as { id?: string }).id));
}
```

`ExtensionLoader` 在 `register()` 阶段把 `api.registerImageGenerationProvider(provider)` 调用结果累积到 `Map<key, T[]>`，运行时再被 `resolvePluginCapabilityProviders` 读出。

### 10.5 bundled 生成脚本

```javascript
// scripts/generate-bundled-image-providers.mjs
// 仿照 generate-bundled-channel-plugins.mjs

const root = path.join(__dirname, '..');
const extensionsRoot = path.join(root, 'extensions');
const outPath = path.join(root, 'src/generated/bundled-image-generation-providers.ts');

function readBundledEntries() {
  const entries = [];
  for (const dirent of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(extensionsRoot, dirent.name, 'package.json'), 'utf8'));
    const bp = pkg.xopc?.bundledImageGenerationProvider;
    if (!bp?.export) continue;
    entries.push({
      dir: dirent.name,
      moduleRel: (bp.module ?? 'src/index.js').replace(/^\.\//, ''),
      exportName: bp.export.trim(),
      order: typeof bp.order === 'number' ? bp.order : 0,
    });
  }
  entries.sort((a, b) => a.order - b.order || a.dir.localeCompare(b.dir));
  return entries;
}

function buildSource(entries) {
  const header = `/**
 * Built-in image-generation providers.
 * Regenerate: pnpm run generate:bundled-image-providers
 */

`;
  const imports = entries.map((e, i) =>
    `import { ${e.exportName} as builder${i} } from '../../extensions/${e.dir}/${e.moduleRel.replace(/\.ts$/, '.js')}';`,
  ).join('\n');
  const body =
    `export const bundledImageGenerationProviderBuilders = [\n` +
    entries.map((_, i) => `  builder${i},`).join('\n') +
    `\n];\n`;
  return header + imports + '\n\n' + body;
}
```

输出文件示例：

```typescript
// src/generated/bundled-image-generation-providers.ts (生成)
import { buildOpenAIImageGenerationProvider as builder0 } from '../../extensions/openai/image-generation-provider.js';
import { buildDashScopeImageGenerationProvider as builder1 } from '../../extensions/dashscope/image-generation-provider.js';
import { buildMinimaxImageGenerationProvider as builder2 } from '../../extensions/minimax/image-generation-provider.js';

export const bundledImageGenerationProviderBuilders = [builder0, builder1, builder2];
```

`package.json` 加：

```json
{
  "scripts": {
    "generate:bundled-image-providers": "node scripts/generate-bundled-image-providers.mjs",
    "build": "pnpm run generate:bundled-channels && pnpm run generate:bundled-image-providers && tsdown && pnpm run -C web build"
  }
}
```

### 10.6 启动时注入

```typescript
// src/agent/image/generation/bundled.ts （新增，与 channels/plugins/bundled.ts 平行）

import { bundledImageGenerationProviderBuilders } from '../../../generated/bundled-image-generation-providers.js';
import { registerBundledImageGenerationProviders } from './bundled-registry.js';

registerBundledImageGenerationProviders(bundledImageGenerationProviderBuilders);
```

```typescript
// src/agent/image/generation/bundled-registry.ts

import type { ImageGenerationProvider } from './types.js';
import { getRegisteredCapabilityProviders, registerCapabilityProvider } from '../../../extensions/loader.js';

export function registerBundledImageGenerationProviders(
  builders: Array<() => ImageGenerationProvider>,
): void {
  for (const build of builders) {
    registerCapabilityProvider('imageGenerationProviders', build());
  }
}
```

> 这套机制保证：
> 1. **官方默认 Provider** 与第三方 Provider 走同一注册路径，没有"特权"
> 2. 用户可以通过 `cfg.extensions['openai'].enabled = false` 关掉自带 Provider 而不影响内核构建
> 3. 第三方插件通过 npm 安装后只要 `package.json` 含 `xopc.bundledImageGenerationProvider` 就能在下次 `pnpm run build` 时自动 wire 进来

### 10.7 与 Slot 的关系

`src/extensions/slots.ts` 的 `'imageGeneration'` slot **不被废弃**，但语义改为：「UI 默认显示哪家 Provider 的配置面板」。它**不影响** registry 的多 Provider 共存能力（registry 永远是多对多）。

---

## 11. 三家 Provider 落地 + Google/Fal 蓝图

> 本节给三家"必须迁移"的 Provider 完整代码骨架；Google/Fal 给出蓝图但不立即落地。
> 所有文件路径以 xopc 仓库为基准。

### 11.1 OpenAI (`extensions/openai/image-generation-provider.ts`)

```typescript
import { Buffer } from 'node:buffer';

import { resolveApiKeyForProvider } from '../../src/providers/auth-runtime/index.js';
import {
  postJsonRequest,
  postMultipartRequest,
  resolveProviderHttpRequestConfig,
  assertOkOrThrowHttpError,
} from '../../src/providers/http/index.js';
import { OPENAI_DEFAULT_IMAGE_MODEL } from '../../src/agent/image/generation/constants.js';
import {
  parseOpenAiCompatibleImageResponse,
  type OpenAiCompatibleImageResponsePayload,
} from '../../src/agent/image/generation/image-assets.js';
import type { ImageGenerationProvider } from '../../src/agent/image/generation/types.js';

const DEFAULT_OPENAI_IMAGE_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_IMAGE_MODELS = ['gpt-image-1', 'dall-e-3', 'dall-e-2'] as const;
const OPENAI_SUPPORTED_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;
const OPENAI_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;
const OPENAI_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;
const OPENAI_BACKGROUNDS = ['transparent', 'opaque', 'auto'] as const;
const OPENAI_MAX_INPUT_IMAGES = 1;
const OPENAI_DEFAULT_TIMEOUT_MS = 120_000;

export function buildOpenAIImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'openai',
    aliases: ['openai-codex'],
    label: 'OpenAI',
    defaultModel: OPENAI_DEFAULT_IMAGE_MODEL,
    models: [...OPENAI_IMAGE_MODELS],
    capabilities: {
      generate: { maxCount: 4, supportsSize: true },
      edit: { enabled: true, maxCount: 4, maxInputImages: OPENAI_MAX_INPUT_IMAGES, supportsSize: true },
      geometry: { sizes: [...OPENAI_SUPPORTED_SIZES] },
      output: {
        qualities: [...OPENAI_QUALITIES],
        formats: [...OPENAI_OUTPUT_FORMATS],
        backgrounds: [...OPENAI_BACKGROUNDS],
      },
    },
    isConfigured: ({ agentDir }) =>
      isProviderApiKeyConfigured({ provider: 'openai', agentDir }),
    async generateImage(req) {
      const inputImages = req.inputImages ?? [];
      const isEdit = inputImages.length > 0;
      const auth = await resolveApiKeyForProvider({
        provider: 'openai',
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error('OpenAI API key missing');
      }

      const httpCfg = resolveProviderHttpRequestConfig({
        baseUrl: req.cfg?.providers?.openai?.baseUrl,
        defaultBaseUrl: DEFAULT_OPENAI_IMAGE_BASE_URL,
        defaultHeaders: { Authorization: `Bearer ${auth.apiKey}` },
        provider: 'openai',
        capability: 'image',
        transport: 'http',
      });

      const model = (req.model ?? '').trim() || OPENAI_DEFAULT_IMAGE_MODEL;
      const count = Math.min(req.count ?? 1, 4);
      const size = req.size ?? '1024x1024';
      const url = `${httpCfg.baseUrl}/images/${isEdit ? 'edits' : 'generations'}`;
      const timeoutMs = req.timeoutMs ?? OPENAI_DEFAULT_TIMEOUT_MS;

      const requestResult = isEdit
        ? await (() => {
            const form = new FormData();
            form.set('model', model);
            form.set('prompt', req.prompt);
            form.set('n', String(count));
            form.set('size', size);
            appendOpenAIImageOptions(form, req);
            for (const [i, image] of inputImages.entries()) {
              const mt = image.mimeType?.trim() || 'image/png';
              form.append('image[]', new Blob([new Uint8Array(image.buffer)], { type: mt }),
                          image.fileName || `image-${i + 1}.png`);
            }
            const headers = new Headers(httpCfg.headers);
            headers.delete('Content-Type');
            return postMultipartRequest({
              url, headers, body: form, timeoutMs,
              allowPrivateNetwork: httpCfg.allowPrivateNetwork,
              dispatcherPolicy: httpCfg.dispatcherPolicy,
            });
          })()
        : await (() => {
            const headers = new Headers(httpCfg.headers);
            headers.set('Content-Type', 'application/json');
            const body: Record<string, unknown> = {
              model, prompt: req.prompt, n: count, size, response_format: 'b64_json',
            };
            appendOpenAIImageOptions(body, req);
            return postJsonRequest({
              url, headers, body, timeoutMs,
              allowPrivateNetwork: httpCfg.allowPrivateNetwork,
              dispatcherPolicy: httpCfg.dispatcherPolicy,
            });
          })();

      const { response, release } = requestResult;
      try {
        await assertOkOrThrowHttpError(
          response,
          isEdit ? 'OpenAI image edit failed' : 'OpenAI image generation failed',
        );
        const data = (await response.json()) as OpenAiCompatibleImageResponsePayload;
        const images = parseOpenAiCompatibleImageResponse(data, {
          defaultMimeType: 'image/png',
          fileNamePrefix: 'image',
          sniffMimeType: true,
        });
        return { images, model };
      } finally {
        await release();
      }
    },
  };
}

function appendOpenAIImageOptions(target: FormData | Record<string, unknown>, req): void {
  const openai = req.providerOptions?.openai;
  const set = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (target instanceof FormData) target.set(key, String(value));
    else (target as Record<string, unknown>)[key] = value;
  };
  if (req.quality) set('quality', req.quality);
  if (req.outputFormat) set('output_format', req.outputFormat);
  const background = openai?.background ?? req.background;
  if (background) set('background', background);
  if (openai?.outputCompression !== undefined) set('output_compression', openai.outputCompression);
  if (openai?.moderation) set('moderation', openai.moderation);
  if (openai?.user) set('user', openai.user);
}
```

> **暂不实现**（首次迁移先跳过，但接口预留）：Codex OAuth `/responses` SSE 路由、Azure OpenAI `api-key` header、`hasExplicitOpenAIDirectAuthConfig` 判断。这些功能进 [§14 Step 4](#14-分阶段迁移路径) 的"高级鉴权"迭代。

### 11.2 DashScope (`extensions/dashscope/image-generation-provider.ts`)

```typescript
import { resolveApiKeyForProvider } from '../../src/providers/auth-runtime/index.js';
import {
  postJsonRequest,
  resolveProviderHttpRequestConfig,
  assertOkOrThrowHttpError,
} from '../../src/providers/http/index.js';
import { DASHSCOPE_DEFAULT_IMAGE_MODEL } from '../../src/agent/image/generation/constants.js';
import type { ImageGenerationProvider } from '../../src/agent/image/generation/types.js';

const DASHSCOPE_IMAGE_ENDPOINTS = {
  beijing:   'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  singapore: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  us:        'https://dashscope-us.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
} as const;

const DASHSCOPE_SUPPORTED_SIZES = [
  '1024x1024', '1280x1280', '720x1280', '1280x720', '1664x928', '928x1664',
] as const;

export function buildDashScopeImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'dashscope',
    label: 'DashScope (Alibaba)',
    defaultModel: DASHSCOPE_DEFAULT_IMAGE_MODEL,
    models: [DASHSCOPE_DEFAULT_IMAGE_MODEL],
    capabilities: {
      generate: { maxCount: 4, supportsSize: true },
      edit: { enabled: false },
      geometry: { sizes: [...DASHSCOPE_SUPPORTED_SIZES] },
    },
    isConfigured: ({ agentDir }) =>
      isProviderApiKeyConfigured({ provider: 'dashscope', agentDir }),
    async generateImage(req) {
      const auth = await resolveApiKeyForProvider({
        provider: 'dashscope',
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error(
          'DashScope API key missing (set DASHSCOPE_API_KEY or providers.dashscope)',
        );
      }

      const region = resolveDashScopeImageRegion(req.cfg);
      const url = req.cfg?.providers?.dashscope?.imageBaseUrl?.trim()
        || DASHSCOPE_IMAGE_ENDPOINTS[region];
      const httpCfg = resolveProviderHttpRequestConfig({
        baseUrl: url,
        defaultBaseUrl: DASHSCOPE_IMAGE_ENDPOINTS.beijing,
        defaultHeaders: {
          Authorization: `Bearer ${auth.apiKey}`,
          'Content-Type': 'application/json',
        },
        provider: 'dashscope',
        capability: 'image',
        transport: 'http',
      });

      const { response, release } = await postJsonRequest({
        url: httpCfg.baseUrl,
        headers: httpCfg.headers,
        body: {
          model: req.model || DASHSCOPE_DEFAULT_IMAGE_MODEL,
          input: { messages: [{ role: 'user', content: [{ text: req.prompt }] }] },
          parameters: {
            prompt_extend: true,
            watermark: false,
            n: Math.min(req.count ?? 1, 4),
            size: mapSizeToDashScopeFormat(req.size),
          },
        },
        timeoutMs: req.timeoutMs ?? 180_000,
        allowPrivateNetwork: httpCfg.allowPrivateNetwork,
        dispatcherPolicy: httpCfg.dispatcherPolicy,
      });

      try {
        await assertOkOrThrowHttpError(response, 'DashScope image generation failed');
        const data = await response.json();
        const urls = collectImageUrls(data);
        if (urls.length === 0) throw new Error('DashScope returned no image URLs');
        const images = await fetchImageBuffers(urls, /* signal */ undefined);
        return { images, model: req.model || DASHSCOPE_DEFAULT_IMAGE_MODEL };
      } finally {
        await release();
      }
    },
  };
}

function resolveDashScopeImageRegion(cfg): keyof typeof DASHSCOPE_IMAGE_ENDPOINTS {
  const raw = (cfg?.providers?.dashscope?.region
    ?? process.env.DASHSCOPE_REGION
    ?? process.env.DASHSCOPE_IMAGE_REGION
    ?? '').trim().toLowerCase();
  if (['singapore', 'sg', 'intl'].includes(raw)) return 'singapore';
  if (['us', 'us-east-1'].includes(raw)) return 'us';
  return 'beijing';
}

function mapSizeToDashScopeFormat(size?: string): string {
  // '1024x1024' → '1024*1024'
  if (!size?.trim()) return '1280*1280';
  const m = /^(\d+)\s*[xX]\s*(\d+)$/.exec(size.trim());
  return m ? `${m[1]}*${m[2]}` : '1280*1280';
}
```

> **变更要点**：
> - `region` 配置从 env-only 提升为 `cfg.providers.dashscope.region`，env 仅作 fallback
> - 之前 `mapSizeToDashScopeFormat` 在 Provider 内部硬编码默认值；新版默认值仍在 Provider，但 normalization 层会**先**把不支持的 size 映射为最近邻，再传进来

### 11.3 MiniMax (`extensions/minimax/image-generation-provider.ts`)

```typescript
const DEFAULT_MINIMAX_IMAGE_BASE_URL = 'https://api.minimax.io';
const CN_MINIMAX_IMAGE_BASE_URL = 'https://api.minimaxi.com';
const MINIMAX_SUPPORTED_ASPECT_RATIOS = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'] as const;

export function buildMinimaxImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: 'minimax',
    label: 'MiniMax',
    defaultModel: 'image-01',
    models: ['image-01'],
    capabilities: {
      generate: { maxCount: 9, supportsAspectRatio: true },
      edit: { enabled: true, maxCount: 9, maxInputImages: 1, supportsAspectRatio: true },
      geometry: { aspectRatios: [...MINIMAX_SUPPORTED_ASPECT_RATIOS] },
    },
    isConfigured: ({ agentDir }) =>
      isProviderApiKeyConfigured({ provider: 'minimax', agentDir }),
    async generateImage(req) {
      const auth = await resolveApiKeyForProvider({
        provider: 'minimax', cfg: req.cfg, agentDir: req.agentDir, store: req.authStore,
      });
      if (!auth.apiKey) throw new Error('MiniMax API key missing');

      const baseUrl = resolveMinimaxImageBaseUrl(req.cfg);
      const httpCfg = resolveProviderHttpRequestConfig({
        baseUrl, defaultBaseUrl: DEFAULT_MINIMAX_IMAGE_BASE_URL,
        defaultHeaders: { Authorization: `Bearer ${auth.apiKey}`, 'Content-Type': 'application/json' },
        provider: 'minimax', capability: 'image', transport: 'http',
      });

      const { response, release } = await postJsonRequest({
        url: `${httpCfg.baseUrl}/v1/image_generation`,
        headers: httpCfg.headers,
        body: {
          model: req.model || 'image-01',
          prompt: req.prompt,
          aspect_ratio: req.aspectRatio || '1:1',
          response_format: 'base64',
          n: Math.min(req.count ?? 1, 9),
        },
        timeoutMs: req.timeoutMs ?? 120_000,
        allowPrivateNetwork: httpCfg.allowPrivateNetwork,
        dispatcherPolicy: httpCfg.dispatcherPolicy,
      });
      try {
        await assertOkOrThrowHttpError(response, 'MiniMax image generation failed');
        const data = await response.json();
        const list: string[] = data?.data?.image_base64 ?? [];
        if (list.length === 0) throw new Error('MiniMax returned no images');
        const images = list.map((b64, i) => ({
          buffer: Buffer.from(b64, 'base64'),
          mimeType: 'image/jpeg',
          fileName: `image-${i + 1}.jpg`,
        }));
        return { images, model: req.model || 'image-01' };
      } finally {
        await release();
      }
    },
  };
}

function resolveMinimaxImageBaseUrl(cfg): string {
  const apiHost = process.env.MINIMAX_API_HOST?.trim();
  if (apiHost && /minimaxi\.com$/i.test(new URL(apiHost.startsWith('http') ? apiHost : `https://${apiHost}`).hostname)) {
    return CN_MINIMAX_IMAGE_BASE_URL;
  }
  const cfgHost = cfg?.providers?.minimax?.baseUrl;
  if (cfgHost && /minimaxi\.com$/i.test(new URL(cfgHost.startsWith('http') ? cfgHost : `https://${cfgHost}`).hostname)) {
    return CN_MINIMAX_IMAGE_BASE_URL;
  }
  return DEFAULT_MINIMAX_IMAGE_BASE_URL;
}
```

### 11.4 Google Gemini Image（蓝图，[§14 Step 3](#14-分阶段迁移路径) 落地）

- 落点：`extensions/google/image-generation-provider.ts`
- API：`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
- 默认模型：`gemini-3-pro-image-preview`（具体模型 id 以官方为准）
- 鉴权：`?key=<API_KEY>` query 或 `Authorization: Bearer`
- 能力：
  - `generate.maxCount: 4`
  - `generate.supportsSize: true` 且 `supportsAspectRatio: true` 且 `supportsResolution: true`
  - `edit.enabled: true`，`maxInputImages: 5`
  - `geometry.sizes: ['1024x1024','1024x1536','1536x1024','1024x1792','1792x1024']`
  - `geometry.aspectRatios: ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9']`
- 实现要点：响应 `candidates[].content.parts[].inlineData.{mimeType,data}` 解析；size 同时映射为 `aspectRatio` + `imageSize:'2K'|'4K'` 配合发送

### 11.5 Fal.ai（蓝图，[§14 Step 3](#14-分阶段迁移路径) 落地）

- 落点：`extensions/fal/image-generation-provider.ts`
- API：`https://queue.fal.run/<model>` （**异步队列**，需要 polling）
- 默认模型：`fal-ai/flux-pro/v1.1`
- 实现要点：
  - 提交任务 → 返回 `request_id`
  - 轮询 `https://queue.fal.run/<model>/requests/<id>/status` 直到 `COMPLETED`
  - 拉取 `https://queue.fal.run/<model>/requests/<id>` 拿到 `images[].url`
  - 再用 `fetch(url)` 下载
- 因为是异步任务，`generateImage` 内部需要在 `req.timeoutMs` 之内完成所有步骤；可以借用 [§7.2 deadline](#72-关键签名)

### 11.6 Provider 注册顺序与默认 fallback

`scripts/generate-bundled-image-providers.mjs` 按 `xopc.bundledImageGenerationProvider.order` 排序：

| Provider | order | 备注 |
|---|---|---|
| openai    | 10 | 通用最广 |
| dashscope | 20 | 中文 prompt 表现好 |
| minimax   | 30 | 替补 |
| google    | 40 | （后续）多模态强 |
| fal       | 50 | （后续）开源模型选择多 |

`generateImage()` 在 `candidates.length === 0` 时按 order 顺序尝试 `isConfigured()` 通过的第一个 Provider 作为兜底（替代当前硬编码的 `openai/gpt-image-1`）。

---

## 12. 工具层 image_generate

> 落点：`src/agent/tools/image-generate-tool.ts`（改造）。LLM 看到的工具 schema、CLI/Web UI 的入参表单都依赖本节。

### 12.1 入参 schema 扩展

```typescript
// src/agent/tools/image-generate-tool.ts (摘要)

import { Type } from '@sinclair/typebox';

const ImageGenerateToolSchema = Type.Object({
  action: Type.Optional(Type.Union([Type.Literal('generate'), Type.Literal('list')], {
    description: '"generate" (默认) 或 "list" 列出已注册 Provider。',
  })),
  prompt: Type.Optional(Type.String({ description: '图像生成 prompt。generate 时必填。' })),
  model: Type.Optional(Type.String({
    description: 'provider/model，如 openai/gpt-image-1 / dashscope/wan2.6-t2i / minimax/image-01。',
  })),

  // 几何
  size: Type.Optional(Type.String({ description: '像素尺寸，如 1024x1024。' })),
  aspectRatio: Type.Optional(Type.String({ description: '比例，如 16:9 / 9:16 / 1:1。' })),
  resolution: Type.Optional(Type.Union([
    Type.Literal('1K'), Type.Literal('2K'), Type.Literal('4K'),
  ])),

  // 输出
  count: Type.Optional(Type.Number({ minimum: 1, maximum: 9 })),
  outputFormat: Type.Optional(Type.Union([
    Type.Literal('png'), Type.Literal('jpeg'), Type.Literal('webp'),
  ])),
  quality: Type.Optional(Type.Union([
    Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('auto'),
  ])),
  background: Type.Optional(Type.Union([
    Type.Literal('transparent'), Type.Literal('opaque'), Type.Literal('auto'),
  ])),

  // 编辑
  inputImages: Type.Optional(Type.Array(Type.Object({
    /** 工作区相对路径或 data: URL；不接受任意 http(s) URL（沙箱）。 */
    source: Type.String(),
  }), { description: '编辑模式参考图。' })),

  // 厂商专属
  providerOptions: Type.Optional(Type.Object({
    openai: Type.Optional(Type.Object({
      moderation: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('auto')])),
      outputCompression: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
      user: Type.Optional(Type.String()),
    })),
  })),

  // 输出落地
  filename: Type.Optional(Type.String({ description: '保存文件名前缀（可选）。' })),
});
```

### 12.2 沙箱：inputImages 加载

```typescript
// src/agent/tools/image-generate-tool.ts

async function loadInputImages(params: {
  workspace: string;
  sources: Array<{ source: string }>;
}): Promise<ImageGenerationSourceImage[]> {
  const out: ImageGenerationSourceImage[] = [];
  for (const { source } of params.sources) {
    if (/^data:image\//i.test(source)) {
      const parsed = parseImageDataUrl(source);
      if (!parsed) throw new ToolInputError('Invalid data URL.');
      out.push({
        buffer: Buffer.from(parsed.base64, 'base64'),
        mimeType: parsed.mimeType,
      });
      continue;
    }
    if (/^https?:\/\//i.test(source)) {
      throw new ToolInputError('Sandboxed image_generate does not allow remote URLs.');
    }
    // 工作区相对路径
    const resolved = path.resolve(params.workspace, source);
    if (!resolved.startsWith(params.workspace + path.sep)) {
      throw new ToolInputError('inputImages.source escapes workspace.');
    }
    const buffer = await fs.readFile(resolved);
    const mimeType = mimeTypeFromFileName(resolved) ?? sniffImageMimeType(buffer).mimeType;
    out.push({ buffer, mimeType, fileName: path.basename(resolved) });
  }
  return out;
}
```

> 与 openclaw `Sandboxed image_generate does not allow remote URLs.` 行为对齐。如果未来要允许公网 URL，必须走 SSRF 白名单（与 §7.3 同一套机制）。

### 12.3 调用 runtime 与回写文件

```typescript
async execute(_toolCallId, args) {
  const params = args as Record<string, unknown>;
  const action = (readStringParam(params, 'action') ?? 'generate').toLowerCase();

  if (action === 'list') {
    const providers = listImageGenerationProvidersSummary(options.config);
    return {
      content: [{ type: 'text', text: providers.map(p =>
        `${p.id}${p.label ? ` (${p.label})` : ''} default=${p.defaultModel}\n  models: ${p.models.join(', ')}`,
      ).join('\n') }],
      details: { providers },
    };
  }

  const prompt = readStringParam(params, 'prompt');
  if (!prompt) {
    return { content: [{ type: 'text', text: 'prompt is required.' }], details: { error: 'missing_prompt' } };
  }
  const inputImages = await loadInputImages({
    workspace: options.workspace,
    sources: (params.inputImages as Array<{ source: string }>) ?? [],
  });

  try {
    const result = await generateImage({
      cfg: effectiveCfg,
      prompt,
      modelOverride: readStringParam(params, 'model'),
      count: typeof params.count === 'number' ? params.count : undefined,
      size: readStringParam(params, 'size'),
      aspectRatio: readStringParam(params, 'aspectRatio'),
      resolution: params.resolution as ImageGenerationResolution | undefined,
      quality: params.quality as ImageGenerationQuality | undefined,
      outputFormat: params.outputFormat as ImageGenerationOutputFormat | undefined,
      background: params.background as ImageGenerationBackground | undefined,
      inputImages,
      providerOptions: params.providerOptions as ImageGenerationProviderOptions | undefined,
      agentDir: options.agentDir,
    });
    const paths = await saveGeneratedImages({
      workspace: options.workspace,
      images: result.images,
      filenameHint: readStringParam(params, 'filename'),
    });
    return buildSuccessResult({ result, paths, workspace: options.workspace });
  } catch (e) {
    return buildFailureResult(e);
  }
}
```

### 12.4 用户提示与 metadata 展示

工具的 text 输出按以下结构（**LLM 友好的简短文本** + 详细字段进 `details`）：

```
Generated 2 image(s) with openai/gpt-image-1.
Saved: media/generated/sunrise-ab12-1.png
Saved: media/generated/sunrise-ab12-2.png
Note: requested size 1024x768 → applied 1024x1024 (provider does not list this size).
Note: ignored quality="ultra" (provider supports: low, medium, high, auto).
```

```typescript
function buildSuccessResult({ result, paths, workspace }) {
  const lines: string[] = [
    `Generated ${paths.length} image(s) with ${result.provider}/${result.model}.`,
    ...paths.map(p => `Saved: ${path.relative(workspace, p)}`),
  ];
  for (const [key, entry] of Object.entries(result.normalization ?? {})) {
    if (entry?.requested && entry.applied && entry.requested !== entry.applied) {
      lines.push(`Note: requested ${key}="${entry.requested}" → applied "${entry.applied}".`);
    } else if (entry?.applied && entry.derivedFrom) {
      lines.push(`Note: ${key}="${entry.applied}" derived from ${entry.derivedFrom}.`);
    }
  }
  for (const ig of result.ignoredOverrides ?? []) {
    lines.push(`Note: ignored ${ig.key}="${ig.value}" (not supported by provider).`);
  }
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: {
      provider: result.provider,
      model: result.model,
      paths,
      workspaceRelativePaths: paths.map(p => path.relative(workspace, p).split(path.sep).join('/')),
      attempts: result.attempts,
      normalization: result.normalization,
      ignoredOverrides: result.ignoredOverrides,
      metadata: result.metadata,
    },
  };
}

function buildFailureResult(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: 'text', text: `Image generation failed: ${msg}` }],
    details: {
      error: 'generation_failed',
      ...(isFailoverError(e) ? { reason: e.reason, status: e.status, code: e.code, provider: e.provider, model: e.model } : {}),
    },
  };
}
```

### 12.5 工具默认模型解析

```typescript
// src/agent/tools/image-generate-tool.ts (改造后保留)

export function resolveImageGenerationModelConfigForTool(params: { cfg?: Config }): ToolModelConfig | null {
  const explicit = coerceToolModelConfig(params.cfg?.agents?.defaults?.imageGenerationModel);
  if (hasToolModelConfig(explicit)) {
    return explicit;
  }
  // 旧逻辑：硬编码 [openai/gpt-image-1, dashscope/wan2.6-t2i] 兜底
  // 新逻辑：枚举 listImageGenerationProvidersSummary(cfg)，按 order 取第一个
  //         isConfigured() 为 true 的 provider
  const providers = listImageGenerationProvidersSummary(params.cfg);
  const candidates = providers
    .filter((p) => {
      const provider = getImageGenerationProvider(p.id, params.cfg);
      return provider?.isConfigured?.({ cfg: params.cfg }) ?? false;
    })
    .map((p) => `${p.id}/${p.defaultModel ?? p.models[0]}`)
    .filter(Boolean);

  return buildToolModelConfigFromCandidates({ explicit, candidates });
}
```

### 12.6 Tool factory 注入

```typescript
// src/agent/tools/factory.ts (改造点)

import { createImageGenerateTool } from './image-generate-tool.js';
import '../image/generation/bundled.js';   // ← 副作用：注册 bundled providers

const imageGenerateTool = createImageGenerateTool({
  config,
  workspace,
  agentDir,                                  // ← 新增
});
```

### 12.7 落地路径与命名

```
<workspace>/media/generated/<filename-hint>-<random4>-<i>.<ext>
```

- `filename-hint` 取自工具入参；非法字符 `[^\w.-]` 被替换为空
- `<random4>` 取 `crypto.randomBytes(4).toString('hex')`，避免同 prompt 重复覆盖
- `<ext>` 由 `result.images[i].mimeType` 经 `imageFileExtensionForMimeType()` 解析

---

## 13. 配置 Schema 与 Web UI 适配

> 落点：`src/config/schema.ts`、`src/gateway/hono/`、`web/src/features/settings/`。

### 13.1 Config schema 扩展

`agents.defaults.imageGenerationModel` 当前已存在（`{ primary, fallbacks }`）。需要补：

```typescript
// src/config/schema.ts (改造)

const AgentImageGenerationModelSchema = z.object({
  primary: z.string().optional(),
  fallbacks: z.array(z.string()).optional(),
  /** 整体超时上限（ms），优先级低于 per-call timeoutMs。 */
  timeoutMs: z.number().int().positive().optional(),
  /** candidates 跑完仍失败时是否枚举所有已配置 provider。 */
  autoProviderFallback: z.boolean().optional(),
}).strict();

const AgentDefaultsSchema = z.object({
  // ... 现有字段
  imageGenerationModel: AgentImageGenerationModelSchema.optional(),
}).strict();
```

`providers.dashscope` / `providers.minimax` 等也需要扩字段：

```typescript
const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  region: z.string().optional(),               // ← DashScope 用
  imageBaseUrl: z.string().url().optional(),   // ← DashScope 图像专用 endpoint
  request: z.object({
    timeoutMs: z.number().int().positive().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }).optional(),
}).strict();
```

> **`models.json`** 中已有的 `models[].thinkingFormat` 等字段保持不动；图像生成 capability 不进入 `models.json`，由 Provider 自带 `models[]`。

### 13.2 Gateway API

#### 13.2.1 `GET /api/image/providers`

```typescript
// src/gateway/hono/routes/models.ts (改造)

router.get('/api/image/providers', (c) => {
  const cfg = getCurrentConfig();
  const providers = listImageGenerationProvidersSummary(cfg).map((p) => ({
    id: p.id,
    label: p.label,
    defaultModel: p.defaultModel,
    models: p.models,
    capabilities: p.capabilities,
    configured: getImageGenerationProvider(p.id, cfg)?.isConfigured?.({ cfg }) ?? false,
  }));
  return c.json({ providers });
});
```

返回示例：

```json
{
  "providers": [
    {
      "id": "openai",
      "label": "OpenAI",
      "defaultModel": "gpt-image-1",
      "models": ["gpt-image-1", "dall-e-3", "dall-e-2"],
      "capabilities": {
        "generate": { "maxCount": 4, "supportsSize": true },
        "edit": { "enabled": true, "maxInputImages": 1, "supportsSize": true },
        "geometry": { "sizes": ["1024x1024", "1024x1536", "1536x1024"] },
        "output": { "qualities": ["low","medium","high","auto"], "formats": ["png","jpeg","webp"] }
      },
      "configured": true
    }
  ]
}
```

#### 13.2.2 `PATCH /api/config`

```typescript
// src/gateway/hono/routes/config.ts (改造)

if (body.agents?.defaults?.imageGenerationModel !== undefined) {
  const v = body.agents.defaults.imageGenerationModel;
  if (v === null) {
    delete (config.agents.defaults as Record<string, unknown>).imageGenerationModel;
  } else {
    config.agents.defaults.imageGenerationModel = normalizePatchAgentImageGenerationModel(v);
  }
}

function normalizePatchAgentImageGenerationModel(v: unknown) {
  // 接受 string（视为 primary）或 { primary, fallbacks, timeoutMs, autoProviderFallback }
  if (typeof v === 'string') return { primary: v.trim() };
  const obj = v as Record<string, unknown>;
  return {
    ...(typeof obj.primary === 'string' ? { primary: obj.primary.trim() } : {}),
    ...(Array.isArray(obj.fallbacks) ? { fallbacks: obj.fallbacks.filter((s) => typeof s === 'string').map((s) => (s as string).trim()) } : {}),
    ...(typeof obj.timeoutMs === 'number' ? { timeoutMs: obj.timeoutMs } : {}),
    ...(typeof obj.autoProviderFallback === 'boolean' ? { autoProviderFallback: obj.autoProviderFallback } : {}),
  };
}
```

#### 13.2.3 `config-payload.ts`

```typescript
// src/gateway/hono/lib/config-payload.ts (改造)

return {
  // ...
  imageGenerationModel: agentModelRefToString(cfg.agents?.defaults?.imageGenerationModel) ?? null,
  imageGenerationModelFallbacks: agentModelFallbacksToArray(cfg.agents?.defaults?.imageGenerationModel),
  imageGenerationModelTimeoutMs: cfg.agents?.defaults?.imageGenerationModel?.timeoutMs ?? null,
  imageGenerationModelAutoProviderFallback: cfg.agents?.defaults?.imageGenerationModel?.autoProviderFallback ?? false,
};
```

### 13.3 Web UI 改造

#### 13.3.1 设置页面新增「Image Models」面板

```
web/src/features/settings/
├── pages/image-models-page.tsx          [新增]
├── image-providers-list.tsx             [新增]
├── image-provider-card.tsx              [新增]
└── config-api.ts                        [改造] 加 imageGenerationModelTimeoutMs 等字段
```

路由（与现有 `/settings/models` 平级）：

```
/settings/image-models
```

UI 结构：

```
┌────────────────────────────────────────────────────────────┐
│ Image Generation                            [Refresh]      │
├────────────────────────────────────────────────────────────┤
│ Primary  [openai/gpt-image-1 ▾]                            │
│ Fallback [dashscope/wan2.6-t2i ▾] [+ Add fallback]         │
│ Timeout  [120000] ms     ☑ Auto-fallback to any configured │
├────────────────────────────────────────────────────────────┤
│ ▼ Available providers                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ OpenAI  ✅ Configured                                │  │
│  │ Default: gpt-image-1                                 │  │
│  │ Generate: maxCount=4, size only                      │  │
│  │ Edit: enabled, maxInputImages=1                      │  │
│  │ Sizes: 1024x1024 / 1024x1536 / 1536x1024             │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ DashScope (Alibaba)  ⚠ Missing API key               │  │
│  │ ...                                                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

```typescript
// web/src/features/settings/pages/image-models-page.tsx
const { data: providers } = useSWR<{ providers: ImageProviderSummary[] }>(
  apiUrl('/api/image/providers'), fetchJson,
);
```

#### 13.3.2 `provider-enrichment.ts` 扩展

```typescript
// web/src/features/settings/provider-enrichment.ts (扩展)

dashscope: {
  // 现有字段
  region: ['beijing', 'singapore', 'us'],         // ← 新增 region 选择
  imageBaseUrlOverride: true,                     // ← 允许在 UI 配 imageBaseUrl
},
minimax: {
  apiHostHint: 'CN: api.minimaxi.com / Intl: api.minimax.io',
},
```

#### 13.3.3 `config-api.ts`

```typescript
// web/src/features/settings/config-api.ts (改造)

export interface ConfigAgentsDefaultsForm {
  // ... existing
  imageGenerationModel: string;
  imageGenerationModelFallbacks: string[];
  imageGenerationModelTimeoutMs: number | null;
  imageGenerationModelAutoProviderFallback: boolean;
}

// 在 normalize / serialize 处加入对应字段。
```

### 13.4 CLI 命令扩展

`src/cli/commands/image.ts` 已存在。新增/调整：

```bash
xopc image providers              # 新：列出已注册 image-generation providers + capabilities
xopc image set-primary openai/gpt-image-1
xopc image add-fallback dashscope/wan2.6-t2i
xopc image set-timeout 120000
xopc image enable-auto-fallback
xopc image generate "a sunrise" --size 1024x1024 --count 2 --output ./out
```

实现：直接调 `generateImage()` + `saveGeneratedImages()`，与工具层共享同一个 runtime。

### 13.5 文档更新

- `docs/models.md`：新增「Image Generation」章节，链回本文档
- `docs/extensions.md`：在「How to write an extension」中加入 `xopc.bundledImageGenerationProvider` 字段说明
- `AGENTS.md` 的 `Common Tasks` 表新增一行：

  | New image-generation provider | `extensions/<vendor>/image-generation-provider.ts` + `package.json#xopc.bundledImageGenerationProvider` → `pnpm run generate:bundled-image-providers` |

---

## 14. 分阶段迁移路径

> 4 个迭代，每迭代 ~1 周，可独立合并、独立回滚。每步给出 **触达文件**、**完成判据**、**与上一步的隔离方式**。

### 14.1 Step 1：基础设施落地（不破坏现状）

> 目标：把 HTTP 底盘 / 鉴权层 / FailoverError / media-generation 共享层 **新增**进仓库；现有三家 Provider 仍按老路径运行，等 Step 2 切换。

**触达文件（新增）**：

```
src/providers/http/                         # 全部 §7 文件
src/providers/auth-runtime/                 # 仅 resolveApiKeyForProvider 与 isProviderApiKeyConfigured
                                            # AuthProfileStore 暂用 NoopStore 实现
src/agent/failover-error.ts
src/agent/media-generation/normalization.types.ts
src/agent/media-generation/runtime-shared.ts
src/agent/media-generation/model-ref.ts
```

**完成判据**：

- [ ] `pnpm test` 全绿（含本步新增的 `__tests__/`）
- [ ] `pnpm run typecheck` 全绿
- [ ] 现有 `src/agent/image/generation/runtime.ts` 不动，老 Provider 行为完全一致
- [ ] 新模块独立可单测（依赖只到 `src/config/schema.ts` / `src/utils/logger.ts`）

**隔离方式**：所有新代码无 import 进入老路径，只是"摆在那里"。

### 14.2 Step 2：内核重构 + 三家 Provider 平迁

> 目标：把 `src/agent/image/generation/` 改造为新契约；三家 Provider 实现仍**留在 `src/agent/image/generation/` 内部**（`openai-generate.ts` / `dashscope-generate.ts` / `minimax-generate.ts`），但全部改用新 capabilities 结构、新 HTTP 底盘、新 normalization、新 attempts 结构。

**触达文件（改造）**：

```
src/agent/image/generation/types.ts                  # 加 capabilities 结构
src/agent/image/generation/runtime.ts                # 用 media-generation/runtime-shared
src/agent/image/generation/runtime-types.ts          # 新增
src/agent/image/generation/provider-registry.ts      # 加 aliases / 安全过滤；BUILTIN 仍非空
src/agent/image/generation/normalization.ts          # 新增
src/agent/image/generation/image-assets.ts           # 新增
src/agent/image/generation/model-ref.ts              # 新增（薄封装 parseModelRef）
src/agent/image/generation/openai-compatible-image-provider.ts # 新增工厂
src/agent/image/generation/openai-generate.ts        # 改造：用工厂 + provider-http
src/agent/image/generation/dashscope-generate.ts     # 改造：用 provider-http
src/agent/image/generation/minimax-generate.ts       # 改造：用 provider-http
src/agent/image/index.ts                             # 重新导出新 API
src/agent/tools/image-generate-tool.ts               # 入参扩展 + metadata 回灌（§12）
```

**完成判据**：

- [ ] 三家 Provider 现有 `__tests__` 全部 pass（不修改 mock，必要时加新断言验证 normalization）
- [ ] 新增 normalization 单测：每条决策表（[§6.3](#63-决策表核心)）至少 1 case
- [ ] 新增 image-assets 单测：dataUrl/b64/sniff
- [ ] `xopc image providers` CLI 输出能力结构（手测）
- [ ] 工具层 `image_generate` 旧入参（`prompt/model/size/count`）行为完全兼容

**隔离方式**：内核 `BUILTIN_IMAGE_GENERATION_PROVIDERS` 此时**仍非空**，沿用静态 import 副作用；插件机制还没接进来，extensions/ 目录不动。

### 14.3 Step 3：插件化拆分 + bundled 生成机制

> 目标：把三家 Provider 从 `src/agent/image/generation/` 搬到 `extensions/<vendor>/`，内核 `BUILTIN` 列表清空，全部走 `extensions` 注入；引入 `scripts/generate-bundled-image-providers.mjs`。

**触达文件**：

```
extensions/openai/                                   # 新增 image-generation-provider.ts + package.json 字段
extensions/dashscope/                                # 新建目录
extensions/minimax/                                  # 新建目录
src/agent/image/generation/{openai,dashscope,minimax}-generate.ts  # 删除（→ extensions）
src/agent/image/generation/provider-registry.ts      # BUILTIN = []，引入 resolvePluginCapabilityProviders
src/agent/image/generation/bundled.ts                # 新增：副作用注册
src/agent/image/generation/bundled-registry.ts       # 新增
src/extensions/types/core.ts                         # ExtensionApi 加 registerImageGenerationProvider
src/extensions/loader.ts                             # 实现 capability provider 累积
src/extensions/capability-providers.ts               # 新增
src/generated/bundled-image-generation-providers.ts  # 由脚本生成
scripts/generate-bundled-image-providers.mjs         # 新增
package.json                                         # generate:bundled-image-providers script
```

**完成判据**：

- [ ] `pnpm run generate:bundled-image-providers` 输出与三家 Provider 对应的 import
- [ ] `pnpm run build` 成功，dist 中有 `dist/extensions/openai/image-generation-provider.js` 等
- [ ] 启动后 `GET /api/image/providers` 返回三家
- [ ] 通过 `cfg.extensions['openai'].enabled = false` 关掉 OpenAI 后，列表只返回两家（**第三方关闭能力验证**）
- [ ] Step 2 的所有单测仍 pass，且 attempts 数据结构未变

**隔离方式**：本 Step 是 PR 唯一一次"破坏性"重排；`__tests__` 也按 vendor 同步迁移到 extensions 内。

### 14.4 Step 4：高级能力 + 第二批 Provider

> 目标：把 Step 1-3 没覆盖的高级能力补齐，加 Google / Fal 两家 Provider；同步打开 Web UI 「Image Models」面板。

**触达文件**：

```
src/providers/auth-runtime/auth-profile-store.ts     # 实现真正的磁盘存储 + OAuth refresh
extensions/openai/image-generation-provider.ts       # 加 Codex OAuth /responses + Azure
extensions/google/                                   # 新建目录（§11.4）
extensions/fal/                                      # 新建目录（§11.5）
web/src/features/settings/pages/image-models-page.tsx
web/src/features/settings/image-providers-list.tsx
web/src/features/settings/image-provider-card.tsx
web/src/features/settings/config-api.ts              # 新字段
web/src/app.tsx                                      # 注册路由 /settings/image-models
src/gateway/hono/routes/models.ts                    # GET /api/image/providers 已在 Step 3 上线，本步加 /api/image/providers/:id/test
```

**完成判据**：

- [ ] OpenAI 在仅有 `OPENAI_OAUTH_TOKEN` 时也能成功生成（Codex 路由）
- [ ] Azure 端点（`https://<resource>.openai.azure.com/openai/deployments/...`）能成功生成
- [ ] Google Gemini 一次生成 4 张图，size / aspectRatio / resolution 三选一时归一化正确
- [ ] Fal 异步任务在 120s 内完成全流程
- [ ] Web UI `/settings/image-models` 页面显示 5 家 Provider，`Configured` 状态正确
- [ ] `xopc image generate "..."` CLI 端到端 pass

**隔离方式**：每加一家 Provider 是独立 PR；OAuth/Azure 是独立 PR；Web UI 是独立 PR。

### 14.5 时间线建议

| 周次 | 步骤 | 主要产出 |
|---|---|---|
| W1 | Step 1 | 基础设施 PR（不影响线上） |
| W2 | Step 2 | 内核重构 PR（行为兼容） |
| W3 | Step 3 | 插件化 PR（扩展性达标） |
| W4 | Step 4a | OpenAI Codex/Azure + Web UI |
| W4+ | Step 4b | Google/Fal Provider |

---

## 15. 兼容性、回滚、测试矩阵、风险

### 15.1 配置兼容性

| 老配置 | 新版本行为 |
|---|---|
| `agents.defaults.imageGenerationModel = "openai/gpt-image-1"` (string) | 自动 normalize 为 `{ primary: "openai/gpt-image-1" }`（已通过 `coerceToolModelConfig` 支持） |
| `agents.defaults.imageGenerationModel = { primary, fallbacks }` | 直接兼容 |
| 未设置 | 走 [§12.5](#125-工具默认模型解析) 的"枚举已配置 provider"兜底，不再强制 `openai/gpt-image-1` |
| `providers.dashscope = { apiKey }` | 直接兼容；`region` / `imageBaseUrl` 为新字段，缺省时走老逻辑（北京 endpoint） |
| 旧环境变量 `DASHSCOPE_REGION` | 仍生效，但优先级低于 `cfg.providers.dashscope.region` |
| 旧环境变量 `DASHSCOPE_IMAGE_BASE_URL` | 仍生效，但优先级低于 `cfg.providers.dashscope.imageBaseUrl` |
| 旧 `OPENAI_BASE_URL` | 仍生效，与 `cfg.providers.openai.baseUrl` 互为后备 |

### 15.2 工具入参兼容性

| 老入参 | 新版本行为 |
|---|---|
| `{ prompt, model?, size?, count?, action?, filename? }` | **完全兼容**，行为不变 |
| 新增 `aspectRatio / resolution / quality / outputFormat / background / inputImages / providerOptions` | LLM 不传则全部 undefined，等价于老行为 |
| 工具返回 `details.attempts` | 字段从 `{ provider, model, error }` 扩展为 `{ provider, model, error, reason?, status?, code? }`，老字段保留，UI 不会破 |
| 工具返回新增 `details.normalization / details.ignoredOverrides / details.metadata` | 新字段，UI 可选展示 |

### 15.3 API 兼容性

| Endpoint | 变更 |
|---|---|
| `POST /api/agent` | 不变 |
| `GET /api/sessions/:key` | 不变 |
| `GET /api/config` | `agents.defaults.imageGenerationModel` 序列化结果可能多出 `timeoutMs` / `autoProviderFallback`；旧 UI 忽略多余字段，**前后兼容** |
| `PATCH /api/config` | 接受新字段；Step 3 之前老字段必须仍能正常 PATCH |
| `GET /api/image/providers` | **新 endpoint**（Step 3 起） |
| `GET /api/models` | 不再混入 image-generation 信息，建议 Web UI 从 `/api/image/providers` 拉数据 |

### 15.4 回滚策略

| 步骤 | 回滚方式 |
|---|---|
| Step 1 | 直接 revert PR，删除新目录即可，无副作用 |
| Step 2 | revert PR；老 `__tests__` 在 PR 内已经全绿，证明行为兼容；attempts 字段是**累加**而非替换，回滚后旧 UI 也能解析 |
| Step 3 | **最敏感**。回滚需要：① revert 代码 ② 重新跑 `generate-bundled-image-providers` 删除 generated 文件 ③ 把 `extensions/dashscope|minimax/` 整目录删除（OpenAI 目录可保留，因为 Step 4 还要用）。**强烈建议** Step 3 单独发布、灰度一周再做 Step 4 |
| Step 4a | OAuth/Azure 是新增分支，回滚直接 revert；Web UI 路由用 feature flag 控制（`gateway.console.imageModelsPage = true`） |
| Step 4b | 单独 revert 对应 Provider 目录即可 |

### 15.5 测试矩阵

| 类别 | 文件位置 | 关键 case |
|---|---|---|
| 单测：normalization | `src/agent/image/generation/__tests__/normalization.test.ts` | §6.3 决策表每行 1 case；ignored override；derivedFrom 标注 |
| 单测：image-assets | `src/agent/image/generation/__tests__/image-assets.test.ts` | b64→Buffer；dataUrl 解析；sniff PNG/JPEG/WebP；不合法输入 |
| 单测：provider-registry | `src/agent/image/generation/__tests__/provider-registry.test.ts` | aliases 解析；prototype pollution；按 cfg.extensions 过滤 |
| 单测：runtime | `src/agent/image/generation/__tests__/runtime.test.ts` | candidates 顺序；single failure → next；all failed → throwCapabilityGenerationFailure；attempts 含 status/reason |
| 单测：HTTP | `src/providers/http/__tests__/*.test.ts` | timeout abort；SSRF 拒绝；multipart 头处理；deadline 取较小值 |
| 单测：FailoverError | `src/agent/__tests__/failover-error.test.ts` | reasonFromHttpStatus；isFailoverError 跨 realm |
| 单测：media-generation | `src/agent/media-generation/__tests__/runtime-shared.test.ts` | resolveClosestSize 加权算法；resolveCapabilityModelCandidates 各分支 |
| 单测：tool | `src/agent/tools/__tests__/image-generate-tool.test.ts` | inputImages 沙箱；list action；新参数透传；metadata 回灌文本 |
| 单测：vendor providers | `extensions/<vendor>/__tests__/image-generation-provider.test.ts` | mock fetch，断言请求 body 与 capabilities；mock 200/4xx/5xx/timeout |
| Live 测试 | `src/agent/image/generation/__tests__/live.test.ts` | 标 `describe.skip` 默认跳过；CI `IMAGE_LIVE=1` 时跑（需要真实 key） |
| 集成测试 | `src/cli/__tests__/image.test.ts` | `xopc image generate` 走完一遍 mock provider |
| Web UI 编译 | `cd web && pnpm run build` | 确保新页面无 TS 错 |

### 15.6 风险清单

| ID | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | DashScope 三区域 API key 不通用，用户切换 region 后老 key 失效 | 切换后报 401 | UI 在切 region 时弹"请确认已替换对应区域的 API key"提示；docs 注明 |
| R2 | Fal.ai 异步任务在 120s 内可能没完成，导致首次失败 | 用户体验差 | 默认 `timeoutMs=180_000`；UI 显式标注；CLI 加 `--wait 300s` 选项 |
| R3 | 插件化后第三方插件 panic 或 register 抛错，污染整个 Provider 列表 | 整个 image-generation 不可用 | `ExtensionLoader.register()` 包 try/catch，单个插件失败只 warn 不抛；`registerImageGenerationProvider(provider)` 内做 schema 校验 |
| R4 | OpenAI Codex OAuth refresh 在并发请求下重复刷新 | OAuth 限流 | `AuthProfileStore.refresh()` 加 promise dedup（同 profile 同时只跑一份） |
| R5 | normalization 把 `1024x1024` 改成 `1024x1536`，用户不知情 | 出图与预期不符 | 必须在工具文本输出中显式提示（[§12.4](#124-用户提示与-metadata-展示)），且在 Web UI 的图像下方展示 |
| R6 | bundled 生成脚本与 channels 共用机制冲突 | build 时报错 | 两个脚本完全独立的 `package.json` 字段（`xopc.bundledChannel` vs `xopc.bundledImageGenerationProvider`），各自维护各自的 generated 文件 |
| R7 | Step 3 删除 `src/agent/image/generation/openai-generate.ts` 等文件，下游引用断 | 编译失败 | `src/agent/image/index.ts` 的 barrel 重新导出从 `extensions/<vendor>/...` 而不是删除导出名；CI 跑 `pnpm run typecheck` 拦截 |
| R8 | Provider `isConfigured` 同步化后若涉及读 keychain 会触发系统弹窗 | UI 卡顿 | 明确规定 `isConfigured` **不读 keychain**，仅检查 cfg / env / store profile 数量；OAuth 的 token 解锁延迟到 `generateImage` 时 |
| R9 | 删除 `coerceImageModelConfig(cfg.agents.defaults.imageModel)` 这种"理解侧"重叠逻辑时误删 | 图像理解（vision）功能受影响 | image-helpers / image-model-fallback / tool-model-config **本次不动**；§3 模块清单已标 `[保留]` |
| R10 | Web UI Step 4 上线前有"半成品" `/settings/image-models` 路由 | 用户访问到空页 | 路由用 feature flag `gateway.console.imageModelsPage` 默认 false；Step 4 上线时翻开 |
| R11 | `cfg.extensions[id].enabled = false` 导致用户主用的 Provider 被关，但 `imageGenerationModel.primary` 还指向它 | 报"Provider not registered" | runtime 在生成 candidates 时跳过未注册 provider 并 warn；`/api/config` PATCH 时校验"不要把 primary 指向关闭的 provider"，给警告而非阻止 |
| R12 | `inputImages` 沙箱过严，影响 Telegram 等 channel 把网络图当参考图的场景 | 编辑功能受限 | channel 层先把网络图下载到 `<workspace>/_cache/`，再以工作区相对路径传入；不在 image_generate 内部联网 |

### 15.7 验收 checklist（合并 Step 4 后）

- [ ] 5 家 Provider（openai / dashscope / minimax / google / fal）的 `xopc image generate` 端到端 pass（任意一家有 key 即可）
- [ ] OpenAI 在 `OPENAI_OAUTH_TOKEN`-only / `OPENAI_API_KEY`-only / Azure / 自定义 baseUrl 四种场景下均 pass
- [ ] DashScope 三区域 endpoint 切换正确
- [ ] MiniMax CN/Intl 自动切换正确
- [ ] 工具输出包含 normalization Note，能让用户感知到归一化
- [ ] `attempts` 在 LLM 看到的 `details` 中包含 `reason/status/code`
- [ ] Web UI `/settings/image-models` 显示能力矩阵和 Configured 状态
- [ ] `pnpm test` 全绿；`pnpm run typecheck` 全绿；`cd web && pnpm run build` 全绿
- [ ] 关闭某 Provider 后，UI 列表 / runtime candidates 都正确剔除
- [ ] 新增第三方 Provider（写一个 `extensions/_demo` 走通完整流程）作为 e2e 验证

---

## 附录 A：openclaw 关键文件索引

| 主题 | openclaw 路径 | 备注 |
|---|---|---|
| 内核入口 | `src/image-generation/runtime.ts` | `generateImage()` |
| 类型 | `src/image-generation/types.ts` | `ImageGenerationProvider` / `ImageGenerationCapabilities` |
| 注册表 | `src/image-generation/provider-registry.ts` | 内核 BUILTIN = []，按 cfg 枚举插件 |
| 归一化 | `src/image-generation/normalization.ts` | `resolveImageGenerationOverrides` |
| OpenAI 兼容工厂 | `src/image-generation/openai-compatible-image-provider.ts` | `createOpenAiCompatibleImageGenerationProvider` |
| 资产 | `src/image-generation/image-assets.ts` | b64/dataUrl/sniff |
| 跨能力共享 | `src/media-generation/runtime-shared.ts` | `resolveCapabilityModelCandidates` 等 |
| 错误模型 | `src/agents/failover-error.ts` | `FailoverError` / `describeFailoverError` |
| HTTP 抽象 | `openclaw/plugin-sdk/provider-http` | `postJsonRequest` / `postMultipartRequest` |
| 鉴权抽象 | `openclaw/plugin-sdk/provider-auth-runtime` | `resolveApiKeyForProvider` |
| 插件 SDK | `openclaw/plugin-sdk/image-generation-core` | re-export 套件 |
| Plugin 入口 | `extensions/<vendor>/index.ts` | `definePluginEntry({ register })` |
| OpenAI Provider | `extensions/openai/image-generation-provider.ts` | 含 Codex OAuth/Azure |
| MiniMax Provider | `extensions/minimax/image-generation-provider.ts` | CN/Intl 自动切 endpoint |
| Comfy Provider | `extensions/comfy/image-generation-provider.ts` | 工作流 |
| Google Provider | `extensions/google/image-generation-provider.ts` | Gemini Image |
| Fal Provider | `extensions/fal/image-generation-provider.ts` | 异步任务 |

## 附录 B：xopc 当前可复用基础

| 主题 | xopc 路径 | 复用方式 |
|---|---|---|
| Provider meta | `src/providers/index.ts` | `getApiKey(providerId)`、`PROVIDER_META`、`isProviderConfiguredSync` |
| 环境变量映射 | `src/providers/env-keys.ts` | `PROVIDER_ENV_MAP` |
| 配置入口 | `src/config/schema.ts` | `agents.defaults.imageGenerationModel` 已存在 |
| 配置归一 | `src/config/model-input.ts` | `resolveAgentModelPrimaryValue` / `resolveAgentModelFallbackValues` |
| 工具模型 | `src/agent/image/tool-model-config.ts` | `ToolModelConfig` / `coerceToolModelConfig` |
| 工具兜底 | `src/agent/image/image-helpers.ts` | `applyImageGenerationModelConfigDefaults` |
| 扩展 SDK | `src/extensions/types/core.ts` | `ExtensionApi`、`ExtensionKind: 'image-generation'` |
| Slots | `src/extensions/slots.ts` | `'imageGeneration'` slot 已注册 |
| Bundled 生成机制 | `scripts/generate-bundled-channel-plugins.mjs` + `src/generated/bundled-channel-plugins.ts` | 同样机制复制为 image-providers |
| Logger | `src/utils/logger.ts` | `createLogger('ImageGen')` |
| Tool factory | `src/agent/tools/factory.ts` | 注入 `image_generate` |

