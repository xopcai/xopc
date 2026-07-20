import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCAL_VOICE_MODEL_ID,
  getLocalVoiceModel,
  hasInstalledLocalVoiceModel,
  isLocalVoiceModelInstalled,
  resolveLocalVoiceModelDir,
  resolveLocalVoiceModelMarkerPath,
} from '../models.js';

describe('local voice model catalog', () => {
  let root: string;
  const previousModelDir = process.env.XOPC_VOICE_MODEL_DIR;

  beforeEach(async () => {
    root = join(tmpdir(), `xopc-voice-models-${process.pid}-${Date.now()}`);
    process.env.XOPC_VOICE_MODEL_DIR = root;
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    if (previousModelDir === undefined) delete process.env.XOPC_VOICE_MODEL_DIR;
    else process.env.XOPC_VOICE_MODEL_DIR = previousModelDir;
    await rm(root, { recursive: true, force: true });
  });

  it('uses the Chinese-optimized model by default and rejects unknown ids', () => {
    expect(getLocalVoiceModel(undefined).id).toBe(DEFAULT_LOCAL_VOICE_MODEL_ID);
    expect(getLocalVoiceModel(undefined)).toMatchObject({
      id: 'sensevoice-small',
      engine: 'sherpa-onnx',
      recommended: true,
    });
    expect(() => getLocalVoiceModel('not-a-model')).toThrow('Unknown local voice model');
  });

  it('only treats a model as installed after the marker is written', async () => {
    expect(isLocalVoiceModelInstalled('base')).toBe(false);
    expect(hasInstalledLocalVoiceModel()).toBe(false);

    await mkdir(resolveLocalVoiceModelDir('base'), { recursive: true });
    await writeFile(resolveLocalVoiceModelMarkerPath('base'), '{}');

    expect(isLocalVoiceModelInstalled('base')).toBe(true);
    expect(hasInstalledLocalVoiceModel()).toBe(true);
  });
});
