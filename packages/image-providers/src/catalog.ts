import type { ImageCapabilities, ImageModel, ImageProviderSpec } from './types.js';

export const IMAGE_CATALOG_VERSION = '2026-10-09';
const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const square = ['1024x1024', '1536x1024', '1024x1536'];
const pixelGeometry = (minPixels: number, maxPixels: number, maxEdge: number, step = 1, maxRatio = 8, minEdge = 64) => ({
  sizes: square, pixels: { minPixels, maxPixels, maxEdge, step, maxRatio, minEdge },
});
const cap = (maxCount: number, maxInputs: number, geometry: ImageCapabilities['geometry'], formats: NonNullable<ImageCapabilities['output']>['formats'] = ['png']): ImageCapabilities => ({
  generate: { maxCount, supportsSize: Boolean(geometry?.sizes), supportsAspectRatio: Boolean(geometry?.aspectRatios), supportsResolution: Boolean(geometry?.resolutions) },
  edit: { enabled: maxInputs > 0, maxInputImages: maxInputs, supportsSize: Boolean(geometry?.sizes), supportsAspectRatio: Boolean(geometry?.aspectRatios), supportsResolution: Boolean(geometry?.resolutions) },
  geometry, output: { formats },
});
const model = (id: string, capabilities: ImageCapabilities, name = id, editPath?: string): ImageModel => ({ id, name, capabilities, ...(editPath ? { editPath } : {}) });
const openai = cap(4, 16, { ...pixelGeometry(655360, 8294400, 3840, 16, 3), sizes: [...square, 'auto'] }, ['png', 'jpeg', 'webp']);
openai.output!.qualities = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];
openai.output!.backgrounds = ['transparent', 'opaque', 'auto'];
const wan = (pro: boolean): ImageCapabilities => {
  const value = cap(1, 4, { ...pixelGeometry(768 * 768, (pro ? 4096 : 2048) ** 2, pro ? 8192 : 4096), sizes: [...square, '1K', '2K', ...(pro ? ['4K'] : [])] });
  value.edit!.maxInputBytes = 20 * 1024 * 1024;
  value.edit!.geometry = { ...pixelGeometry(768 * 768, 2048 ** 2, 4096), sizes: [...square, '1K', '2K'] };
  return value;
};
const gemini = (references: number, resolutions: Array<'1K' | '2K' | '4K'>) => cap(1, references, { aspectRatios: ratios, resolutions }, ['png', 'jpeg']);
const seedream = cap(1, 10, { sizes: ['1K', '2K', '4K'] }, ['png', 'jpeg']);
const ideogram = cap(4, 5, { sizes: ['1024x1024', '2048x2048'] });
ideogram.edit = { enabled: true, maxInputImages: 5 };
ideogram.output!.qualities = ['low', 'medium', 'high'];
const flux = cap(1, 8, pixelGeometry(64 * 64, 4_000_000, 4096, 16), ['png', 'jpeg']);

const providers: ImageProviderSpec[] = [
  {
    id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', timeoutMs: 240000,
    documentationUrl: 'https://developers.openai.com/api/docs/guides/image-generation', apiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [model('gpt-image-2.5-flare', openai, 'GPT Image 2.5 Flare'), model('gpt-image-2.5-sunburst', openai, 'GPT Image 2.5 Sunburst')],
  },
  {
    id: 'dashscope', name: 'Alibaba Model Studio', protocol: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com', timeoutMs: 600000,
    regions: { cn: 'https://dashscope.aliyuncs.com', intl: 'https://dashscope-intl.aliyuncs.com' },
    documentationUrl: 'https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference', apiKeyUrl: 'https://bailian.console.aliyun.com/',
    models: [model('qwen-image-3.0-pro', cap(1, 3, pixelGeometry(512 ** 2, 2048 ** 2, 4096))), model('qwen-image-3.0', cap(1, 3, pixelGeometry(512 ** 2, 2048 ** 2, 4096))), model('wan2.7-image-pro', wan(true)), model('wan2.7-image', wan(false))],
  },
  {
    id: 'minimax', name: 'MiniMax', protocol: 'minimax', baseUrl: 'https://api.minimax.io', timeoutMs: 180000,
    regions: { cn: 'https://api.minimaxi.com', intl: 'https://api.minimax.io' },
    documentationUrl: 'https://platform.minimax.io/docs/api-reference/image-generation', apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    models: [model('image-01', cap(1, 0, { aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'] }, ['jpeg'])), model('image-01-live', cap(1, 0, { aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'] }, ['jpeg']))],
  },
  {
    id: 'google', name: 'Google Gemini', protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', timeoutMs: 240000,
    documentationUrl: 'https://ai.google.dev/gemini-api/docs/image-generation', apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    models: [model('gemini-nano-banana-2.1', gemini(14, ['1K', '2K', '4K']), 'Nano Banana 2.1'), model('gemini-3.1-flash-lite-image', gemini(1, ['1K']), 'Nano Banana 2 Lite'), model('gemini-3-pro-image', gemini(14, ['1K', '2K', '4K']), 'Nano Banana Pro')],
  },
  {
    id: 'fal', name: 'fal.ai', protocol: 'fal', baseUrl: 'https://queue.fal.run', timeoutMs: 600000,
    documentationUrl: 'https://fal.ai/models', apiKeyUrl: 'https://fal.ai/dashboard/keys',
    models: [model('fal-ai/flux-2-pro', { ...flux, edit: { ...flux.edit!, enabled: true, maxInputImages: 8 } }, 'FLUX.2 Pro', 'fal-ai/flux-2-pro/edit'), model('google/nano-banana-2.1', gemini(14, ['1K', '2K', '4K']), 'Nano Banana 2.1', 'google/nano-banana-2.1/edit'), model('fal-ai/flux-2/klein/4b', { ...flux, edit: { ...flux.edit!, enabled: true, maxInputImages: 4 } }, 'FLUX.2 Klein 4B', 'fal-ai/flux-2/klein/4b/edit')],
  },
  {
    id: 'seedream', name: 'ByteDance Seedream', protocol: 'seedream', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', timeoutMs: 240000,
    documentationUrl: 'https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh', apiKeyUrl: 'https://ark.volcengine.com/region:cn-beijing/apikey',
    models: [model('doubao-seedream-5-0-flash-260915', seedream, 'Seedream 5.0 Flash'), model('doubao-seedream-5-0-pro-260628', seedream, 'Seedream 5.0 Pro')],
  },
  {
    id: 'ideogram', name: 'Ideogram', protocol: 'ideogram', baseUrl: 'https://api.ideogram.ai', timeoutMs: 240000,
    documentationUrl: 'https://developer.ideogram.ai/ideogram-api/api-overview', apiKeyUrl: 'https://ideogram.ai/manage-api',
    models: [model('ideogram-4-5', ideogram, 'Ideogram 4.5')],
  },
  {
    id: 'bfl', name: 'Black Forest Labs', protocol: 'bfl', baseUrl: 'https://api.bfl.ai/v1', timeoutMs: 600000,
    documentationUrl: 'https://docs.bfl.ai/flux_2/flux2_overview', apiKeyUrl: 'https://dashboard.bfl.ai/',
    models: [model('flux-2-pro', flux, 'FLUX.2 Pro'), model('flux-2-max', flux, 'FLUX.2 Max'), model('flux-2-klein-4b', { ...flux, edit: { ...flux.edit!, enabled: true, maxInputImages: 4 } }, 'FLUX.2 Klein 4B')],
  },
  {
    id: 'zhipu-cn', name: 'Zhipu GLM-Image', protocol: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', timeoutMs: 240000,
    documentationUrl: 'https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image', apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    models: [model('glm-image', cap(1, 0, { ...pixelGeometry(512 ** 2, 2048 ** 2, 2048, 32, 4, 512), sizes: ['1280x1280', '1568x1056', '1056x1568', '1472x1088', '1088x1472', '1728x960', '960x1728'] }))],
  },
  {
    id: 'tokenhub', name: 'Tencent TokenHub', protocol: 'tokenhub', baseUrl: 'https://tokenhub.tencentmaas.com', timeoutMs: 240000,
    documentationUrl: 'https://cloud.tencent.com/document/product/1823/135745', apiKeyUrl: 'https://console.cloud.tencent.com/tokenhub',
    models: [
      model('hy-image-v3.5-preview', { ...cap(1, 20, { ...pixelGeometry(256 ** 2, 4096 ** 2, 8192, 1, 32, 256), sizes: ['1024x1024', '2048x2048', '4096x4096'] }), edit: { enabled: true, maxInputImages: 20, supportsSize: true, inputFormats: ['png', 'jpeg'], maxInputBytes: 20 * 1024 * 1024 } }, 'Hy Image 3.5 Preview'),
      model('hy-image-v3', { ...cap(1, 3, { ...pixelGeometry(512 ** 2, 1024 ** 2, 2048, 1, 4, 512), sizes: ['1024x1024'] }), edit: { enabled: true, maxInputImages: 3, supportsSize: true, inputFormats: ['png', 'jpeg'], maxInputBytes: 10 * 1024 * 1024 } }, 'Hy Image 3.0'),
    ],
  },
  {
    id: 'stability', name: 'Stability AI', protocol: 'stability', baseUrl: 'https://api.stability.ai', timeoutMs: 180000,
    documentationUrl: 'https://platform.stability.ai/docs/api-reference', apiKeyUrl: 'https://platform.stability.ai/account/keys',
    models: [model('stable-image-ultra', cap(1, 0, { aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'] }, ['png', 'jpeg', 'webp'])), model('stable-image-core', cap(1, 0, { aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'] }, ['png', 'jpeg', 'webp']))],
  },
];

export function listImageProviderSpecs(): ImageProviderSpec[] { return structuredClone(providers); }
export function getImageProviderSpec(id: string): ImageProviderSpec {
  const spec = providers.find((item) => item.id === id);
  if (!spec) throw new Error(`Unknown image provider: ${id}`);
  return structuredClone(spec);
}
