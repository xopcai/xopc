import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveStateDir } from '../../config/paths.js';

export type LocalVoiceModelId = 'sensevoice-small' | 'tiny' | 'base' | 'small';

export type LocalVoiceEngine = 'sherpa-onnx' | 'transformers.js';

export interface LocalVoiceModelFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface LocalVoiceModelDefinition {
  id: LocalVoiceModelId;
  name: string;
  description: string;
  engine: LocalVoiceEngine;
  repository: string;
  revision: string;
  dtype?: 'q8';
  files?: readonly LocalVoiceModelFile[];
  languages: readonly string[];
  recommended?: boolean;
  approximateBytes: number;
}

export const DEFAULT_LOCAL_VOICE_MODEL_ID: LocalVoiceModelId = 'sensevoice-small';

export const LOCAL_VOICE_MODELS: readonly LocalVoiceModelDefinition[] = [
  {
    id: 'sensevoice-small',
    name: 'SenseVoice Small 中文',
    description: '中文推荐；适合普通话、粤语和中英混说，支持标点与数字规整。',
    engine: 'sherpa-onnx',
    repository: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    revision: '2365baeacb507f821a0c8120fcee3d484dba7a07',
    files: [
      {
        path: 'model.int8.onnx',
        bytes: 239_233_841,
        sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
      },
      {
        path: 'tokens.txt',
        bytes: 315_894,
        sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
      },
      {
        path: 'LICENSE',
        bytes: 71,
        sha256: '221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17',
      },
    ],
    languages: ['zh', 'yue', 'en', 'ja', 'ko'],
    recommended: true,
    approximateBytes: 239_549_806,
  },
  {
    id: 'tiny',
    name: 'Whisper Tiny',
    description: 'Fastest and smallest; best for short commands.',
    engine: 'transformers.js',
    repository: 'onnx-community/whisper-tiny',
    revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
    dtype: 'q8',
    languages: ['multilingual'],
    approximateBytes: 45 * 1024 * 1024,
  },
  {
    id: 'base',
    name: 'Whisper Base',
    description: 'Recommended balance of accuracy, speed, and disk use.',
    engine: 'transformers.js',
    repository: 'onnx-community/whisper-base',
    revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
    dtype: 'q8',
    languages: ['multilingual'],
    approximateBytes: 80 * 1024 * 1024,
  },
  {
    id: 'small',
    name: 'Whisper Small',
    description: 'Higher accuracy with more memory and disk use.',
    engine: 'transformers.js',
    repository: 'onnx-community/whisper-small',
    revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    dtype: 'q8',
    languages: ['multilingual'],
    approximateBytes: 245 * 1024 * 1024,
  },
] as const;

export function resolveLocalVoiceRootDir(): string {
  return process.env.XOPC_VOICE_MODEL_DIR?.trim() || join(resolveStateDir(), 'voice');
}

export function resolveLocalVoiceModelDir(modelId: string): string {
  return join(resolveLocalVoiceRootDir(), 'models', modelId);
}

export function resolveLocalVoiceModelMarkerPath(modelId: string): string {
  return join(resolveLocalVoiceModelDir(modelId), 'installed.json');
}

export function getLocalVoiceModel(modelId: string | undefined): LocalVoiceModelDefinition {
  const id = modelId?.trim() || DEFAULT_LOCAL_VOICE_MODEL_ID;
  const model = LOCAL_VOICE_MODELS.find((entry) => entry.id === id);
  if (!model) {
    throw new Error(`Unknown local voice model: ${id}`);
  }
  return model;
}

export function isLocalVoiceModelInstalled(modelId: string): boolean {
  return existsSync(resolveLocalVoiceModelMarkerPath(modelId));
}

export function hasInstalledLocalVoiceModel(): boolean {
  return LOCAL_VOICE_MODELS.some((model) => isLocalVoiceModelInstalled(model.id));
}
