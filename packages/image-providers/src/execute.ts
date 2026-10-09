import { getImageProviderSpec } from './catalog.js';
import { assertImageResponseOk, authenticatedJobUrl, decodeBase64, encodeBase64, imageFromBytes, MAX_IMAGE_BYTES, MAX_RESPONSE_BYTES, readBytesLimited, readImageJson, waitForImagePoll } from './http.js';
import type { ImageExecution, ImageModel, ImageResult } from './types.js';
import { ImageProviderError, validateImageRequest } from './validation.js';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

class ImageTransport {
  constructor(readonly execution: ImageExecution) {}
  endpoint(path: string): string { return `${this.execution.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`; }
  async json(url: string, body?: Json, headers: Record<string, string> = {}): Promise<Json> {
    return readImageJson(await this.execution.fetchImpl(url, {
      method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: this.execution.signal, redirect: 'error',
    }));
  }
  async form(url: string, form: FormData, headers: Record<string, string>): Promise<Json> {
    return readImageJson(await this.execution.fetchImpl(url, { method: 'POST', headers, body: form, signal: this.execution.signal, redirect: 'error' }));
  }
  async image(url: unknown): Promise<ImageResult['images'][number]> {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new ImageProviderError('Missing generated image URL', 502);
    const response = await this.execution.fetchImpl(url, { signal: this.execution.signal, redirect: 'error' });
    try { await assertImageResponseOk(response); }
    catch (error) { if (error instanceof ImageProviderError) throw new ImageProviderError(error.message, error.status); throw error; }
    return imageFromBytes(await readBytesLimited(response, MAX_IMAGE_BYTES));
  }
  bearer(): Record<string, string> { return { authorization: `Bearer ${this.execution.apiKey}` }; }
  async dataImages(data: unknown): Promise<ImageResult['images']> {
    const entries = array(data);
    if (entries.length > (this.execution.request.count ?? 1)) throw new ImageProviderError('Provider returned too many images', 502);
    const images: ImageResult['images'] = [];
    let total = 0;
    for (const value of entries) {
      const entry = object(value);
      const image = entry.b64_json ? imageFromBytes(decodeBase64(entry.b64_json)) : await this.image(entry.url);
      total += image.bytes.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new ImageProviderError('Generated images exceed total byte limit', 502);
      images.push(image);
    }
    return images;
  }
}

async function jobJson(http: ImageTransport, url: string, headers: Record<string, string>): Promise<Json> {
  try { return await http.json(url, undefined, headers); }
  catch (error) { if (error instanceof ImageProviderError) throw new ImageProviderError(error.message, error.status); throw error; }
}

async function inputUris(execution: ImageExecution): Promise<string[]> {
  return Promise.all((execution.request.inputImages ?? []).map(async (image) => `data:${image.blob.type};base64,${encodeBase64(new Uint8Array(await image.blob.arrayBuffer()))}`));
}

async function openai(http: ImageTransport): Promise<ImageResult> {
  const { request: req } = http.execution;
  const body: Json = { model: req.model, prompt: req.prompt, n: req.count ?? 1 };
  if (req.size) body.size = req.size;
  if (req.quality) body.quality = req.quality;
  if (req.outputFormat) body.output_format = req.outputFormat;
  if (req.background) body.background = req.background;
  if (req.openai?.moderation) body.moderation = req.openai.moderation;
  if (req.openai?.outputCompression !== undefined) body.output_compression = req.openai.outputCompression;
  if (req.openai?.user) body.user = req.openai.user;
  let data: Json;
  if (req.inputImages?.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) form.append(key, String(value));
    for (const image of req.inputImages) form.append('image[]', image.blob, image.fileName);
    data = await http.form(http.endpoint('/images/edits'), form, http.bearer());
  } else data = await http.json(http.endpoint('/images/generations'), body, http.bearer());
  return { images: await http.dataImages(data.data), usage: data.usage };
}

async function dashscope(http: ImageTransport): Promise<ImageResult> {
  const { request: req } = http.execution;
  const content: Json[] = [{ text: req.prompt }, ...(await inputUris(http.execution)).map((image) => ({ image }))];
  const parameters: Json = { n: req.count ?? 1, watermark: false };
  if (req.size) parameters.size = req.size.replace('x', '*');
  const data = await http.json(http.endpoint('/api/v1/services/aigc/multimodal-generation/generation'), {
    model: req.model, input: { messages: [{ role: 'user', content }] }, parameters,
  }, http.bearer());
  if (data.code) throw new ImageProviderError('DashScope image request rejected', 400);
  const urls = array(object(data.output).choices).flatMap((choice) => array(object(object(choice).message).content))
    .map((item) => object(item).image).filter((url): url is string => typeof url === 'string');
  return { images: await http.dataImages(urls.map((url) => ({ url }))), usage: data.usage, requestId: typeof data.request_id === 'string' ? data.request_id : undefined };
}

async function google(http: ImageTransport): Promise<ImageResult> {
  const { request: req, apiKey } = http.execution;
  const input: Json[] = [{ type: 'text', text: req.prompt }];
  for (const image of req.inputImages ?? []) input.push({ type: 'image', mime_type: image.blob.type, data: encodeBase64(new Uint8Array(await image.blob.arrayBuffer())) });
  const responseFormat: Json = { type: 'image' };
  if (req.aspectRatio) responseFormat.aspect_ratio = req.aspectRatio;
  if (req.resolution) responseFormat.image_size = req.resolution;
  if (req.outputFormat) responseFormat.mime_type = `image/${req.outputFormat}`;
  const data = await http.json(http.endpoint('/v1beta/interactions'), { model: req.model, input, store: false, response_format: responseFormat }, { 'x-goog-api-key': apiKey });
  if (data.status !== 'completed') throw new ImageProviderError('Google image interaction did not complete', 502);
  const final = array(data.steps).filter((step) => object(step).type === 'model_output').at(-1);
  const parts = array(object(final).content).filter((part) => object(part).type === 'image');
  return { images: await http.dataImages(parts.map((part) => ({ b64_json: object(part).data, url: object(part).uri }))), usage: data.usage, requestId: typeof data.id === 'string' ? data.id : undefined };
}

async function fal(http: ImageTransport, model: ImageModel): Promise<ImageResult> {
  const { request: req, apiKey, signal, baseUrl } = http.execution;
  const editing = Boolean(req.inputImages?.length);
  const path = editing ? model.editPath! : req.model;
  const body: Json = { prompt: req.prompt };
  if (req.model.startsWith('google/')) {
    body.num_images = req.count ?? 1;
    if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
    if (req.resolution) body.resolution = req.resolution;
  } else if (req.size) {
    const [width, height] = req.size.split('x').map(Number);
    body.image_size = { width, height };
  }
  if (req.outputFormat) body.output_format = req.outputFormat;
  if (editing) body.image_urls = await inputUris(http.execution);
  const headers = { authorization: `Key ${apiKey}` };
  const submit = await http.json(http.endpoint(path), body, headers);
  const statusUrl = authenticatedJobUrl(submit.status_url, baseUrl);
  const resultUrl = authenticatedJobUrl(submit.response_url, baseUrl);
  for (;;) {
    signal.throwIfAborted();
    const status = await jobJson(http, statusUrl, headers);
    if (status.status === 'COMPLETED') break;
    if (status.status !== 'IN_QUEUE' && status.status !== 'IN_PROGRESS') throw new ImageProviderError('fal image job failed', 502);
    await waitForImagePoll(signal);
  }
  const result = await jobJson(http, resultUrl, headers);
  return { images: await http.dataImages(result.images), requestId: typeof submit.request_id === 'string' ? submit.request_id : undefined };
}

async function seedream(http: ImageTransport): Promise<ImageResult> {
  const { request: req } = http.execution;
  const images = await inputUris(http.execution);
  const body: Json = { model: req.model, prompt: req.prompt, response_format: 'b64_json', watermark: false };
  if (images.length) body.image = images.length === 1 ? images[0] : images;
  if (req.size) body.size = req.size;
  if (req.outputFormat) body.output_format = req.outputFormat;
  const data = await http.json(http.endpoint('/images/generations'), body, http.bearer());
  if (data.error) throw new ImageProviderError('Seedream image request rejected', 400);
  return { images: await http.dataImages(data.data), usage: data.usage };
}

async function ideogram(http: ImageTransport): Promise<ImageResult> {
  const { request: req, apiKey } = http.execution;
  const headers = { 'Api-Key': apiKey };
  let data: Json;
  if (req.inputImages?.length) {
    const form = new FormData();
    form.append('prompt', req.prompt);
    form.append('num_images', String(req.count ?? 1));
    if (req.quality) form.append('quality', req.quality);
    req.inputImages.forEach((image, index) => form.append(index === 0 ? 'image' : 'reference_images', image.blob, image.fileName));
    data = await http.form(http.endpoint(`/v2/image/precise-edit/${req.model}`), form, headers);
  } else {
    const body: Json = { prompt: req.prompt, num_images: req.count ?? 1 };
    if (req.size) body.resolution = req.size;
    if (req.quality) body.quality = req.quality;
    data = await http.json(http.endpoint(`/v2/image/generate/${req.model}`), body, headers);
  }
  return { images: await http.dataImages(data.data), requestId: typeof data.generation_id === 'string' ? data.generation_id : undefined };
}

async function bfl(http: ImageTransport): Promise<ImageResult> {
  const { request: req, apiKey, baseUrl, signal } = http.execution;
  const body: Json = { prompt: req.prompt };
  if (req.size) { const [width, height] = req.size.split('x').map(Number); body.width = width; body.height = height; }
  if (req.outputFormat) body.output_format = req.outputFormat;
  (await inputUris(http.execution)).forEach((image, index) => { body[index === 0 ? 'input_image' : `input_image_${index + 1}`] = image; });
  const headers = { 'x-key': apiKey };
  const submit = await http.json(http.endpoint(req.model), body, headers);
  const pollUrl = authenticatedJobUrl(submit.polling_url, baseUrl, true);
  for (;;) {
    signal.throwIfAborted();
    const result = await jobJson(http, pollUrl, headers);
    if (result.status === 'Ready') return { images: [await http.image(object(result.result).sample)], requestId: typeof submit.id === 'string' ? submit.id : undefined };
    if (!['Pending', 'Processing'].includes(String(result.status))) throw new ImageProviderError('BFL image job failed', 502);
    await waitForImagePoll(signal);
  }
}

async function minimax(http: ImageTransport): Promise<ImageResult> {
  const { request: req } = http.execution;
  const data = await http.json(http.endpoint('/v1/image_generation'), { model: req.model, prompt: req.prompt, aspect_ratio: req.aspectRatio ?? '1:1', response_format: 'base64', n: req.count ?? 1 }, http.bearer());
  if (object(data.base_resp).status_code) throw new ImageProviderError('MiniMax image request rejected', 400);
  return { images: await http.dataImages(array(object(data.data).image_base64).map((b64_json) => ({ b64_json }))) };
}

async function zhipu(http: ImageTransport): Promise<ImageResult> {
  const { request: req } = http.execution;
  const data = await http.json(http.endpoint('/images/generations'), { model: req.model, prompt: req.prompt, ...(req.size ? { size: req.size } : {}) }, http.bearer());
  if (data.error) throw new ImageProviderError('Zhipu image request rejected', 400);
  return { images: await http.dataImages(data.data) };
}

async function tokenhub(http: ImageTransport): Promise<ImageResult> {
  const { request: req } = http.execution;
  const images = await inputUris(http.execution);
  if (req.model === 'hy-image-v3.5-preview') {
    const data = await http.json(http.endpoint('/v1/wand/hunyuan-image/v35-generation'), { model: req.model, ...(req.size ? { size: req.size } : {}), messages: [{ role: 'user', content: [{ type: 'text', text: req.prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] }] }, http.bearer());
    if (data.error) throw new ImageProviderError('TokenHub image request rejected', 400);
    const urls = array(data.choices).map(choice => object(object(object(choice).delta).image).url).filter(url => typeof url === 'string');
    return { images: await http.dataImages(urls.map(url => ({ url }))), usage: data.tokenhub_usage, requestId: typeof data.request_id === 'string' ? data.request_id : undefined };
  }
  const data = await http.json(http.endpoint('/v1/wand/hunyuan-image/v3-generation'), { model: req.model, prompt: req.prompt, ...(req.size ? { size: req.size } : {}), ...(images.length ? { images: images.map(image => image.slice(image.indexOf(',') + 1)) } : {}) }, http.bearer());
  if (data.error) throw new ImageProviderError('TokenHub image request rejected', 400);
  return { images: await http.dataImages(data.data), usage: data.tokenhub_usage, requestId: typeof data.request_id === 'string' ? data.request_id : undefined };
}

async function stability(http: ImageTransport): Promise<ImageResult> {
  const { request: req, signal, fetchImpl } = http.execution;
  const form = new FormData();
  form.append('prompt', req.prompt);
  if (req.aspectRatio) form.append('aspect_ratio', req.aspectRatio);
  if (req.outputFormat) form.append('output_format', req.outputFormat);
  const response = await fetchImpl(http.endpoint(`/v2beta/stable-image/generate/${req.model === 'stable-image-ultra' ? 'ultra' : 'core'}`), {
    method: 'POST', headers: { ...http.bearer(), accept: 'image/*' }, body: form, signal, redirect: 'error',
  });
  await assertImageResponseOk(response);
  return { images: [imageFromBytes(await readBytesLimited(response, MAX_IMAGE_BYTES))] };
}

const adapters = { openai, dashscope, google, seedream, ideogram, bfl, minimax, zhipu, tokenhub, stability, fal };

export async function executeImageProvider(execution: ImageExecution): Promise<ImageResult> {
  const spec = getImageProviderSpec(execution.providerId);
  const model = spec.models.find((item) => item.id === execution.request.model);
  if (!model) throw new ImageProviderError(`Unsupported image model: ${execution.request.model}`, 400);
  validateImageRequest(execution.request, model.capabilities);
  const maxPrompt = spec.protocol === 'zhipu' ? 1000 : spec.protocol === 'tokenhub' && model.id === 'hy-image-v3' ? 8192 : spec.protocol === 'dashscope' && model.id.startsWith('wan') ? 5000 : Infinity;
  if ([...execution.request.prompt].length > maxPrompt) throw new ImageProviderError('Image prompt exceeds model limit', 400);
  if (execution.request.openai && spec.protocol !== 'openai') throw new ImageProviderError('OpenAI options require an OpenAI image provider', 400);
  execution.signal.throwIfAborted();
  const result = await adapters[spec.protocol](new ImageTransport(execution), model);
  if (!result.images.length || result.images.length > (execution.request.count ?? 1)) throw new ImageProviderError('Provider returned an invalid image count', 502);
  return result;
}
