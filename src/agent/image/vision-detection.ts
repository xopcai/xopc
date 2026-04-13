import { resolveModel } from '../../providers/index.js';

export function modelSupportsVision(modelRef: string): boolean {
  try {
    const model = resolveModel(modelRef);
    if (model?.input?.includes('image')) {
      return true;
    }
  } catch {
    // Model not found in pi-ai registry, fall through to known-good list
  }

  const knownVisionModels = [
    'gpt-4o',
    'gpt-4-turbo',
    'gpt-4-vision',
    'gpt-4.1',
    'gpt-5',
    'o1',
    'o3',
    'o4-mini',
    'claude-sonnet',
    'claude-opus',
    'claude-haiku',
    'gemini',
    'qwen-vl',
    'qwen2.5-vl',
    'qwen-max-vl',
    'qvq',
  ];

  const normalizedRef = modelRef.toLowerCase();
  const modelPart = normalizedRef.includes('/')
    ? normalizedRef.slice(normalizedRef.indexOf('/') + 1)
    : normalizedRef;

  return knownVisionModels.some(
    (known) => modelPart.startsWith(known) || modelPart.includes(known),
  );
}

export type ImageHandlingStrategy = 'native' | 'describe';

export function resolveImageHandlingStrategy(modelRef: string): ImageHandlingStrategy {
  return modelSupportsVision(modelRef) ? 'native' : 'describe';
}
