import { resolveModel } from '../../providers/index.js';

export function modelSupportsVision(modelRef: string): boolean {
  try {
    const model = resolveModel(modelRef);
    return model?.input?.includes('image') === true;
  } catch {
    return false;
  }
}

export type ImageHandlingStrategy = 'native' | 'describe';

export function resolveImageHandlingStrategy(modelRef: string): ImageHandlingStrategy {
  return modelSupportsVision(modelRef) ? 'native' : 'describe';
}
