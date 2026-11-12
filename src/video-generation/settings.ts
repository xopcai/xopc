import { VIDEO_MODEL_REFS, WAN_VIDEO_MODEL_REF, type VideoGenerationDefaults, type VideoModelRef } from '@xopcai/gateway-contract';

import { getCloudMediaDefault } from '../providers/xopc-cloud-media.js';
import { DurableState } from '../storage/sqlite/durable-state.js';

const settings = new DurableState<VideoModelRef>('video-generation');
const defaults = new DurableState<VideoGenerationDefaults>('video-generation-defaults');

export function storedVideoModel(): VideoModelRef | undefined {
  return settings.get('model');
}

export function getVideoModel(): VideoModelRef {
  const selected = storedVideoModel();
  if (selected && VIDEO_MODEL_REFS.includes(selected)) return selected;
  const cloud = getCloudMediaDefault('video');
  return VIDEO_MODEL_REFS.find(ref => ref === cloud) ?? WAN_VIDEO_MODEL_REF;
}

export function setVideoModel(modelRef: VideoModelRef): void {
  settings.set('model', modelRef);
}

export function getVideoDefaults(modelRef: VideoModelRef): VideoGenerationDefaults {
  return defaults.get(modelRef) ?? { duration: 5, resolution: '720P' };
}

export function setVideoDefaults(modelRef: VideoModelRef, value: VideoGenerationDefaults): void {
  defaults.set(modelRef, value);
}
