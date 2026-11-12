import { VIDEO_MODEL_REFS, WAN_VIDEO_MODEL_REF, type VideoGenerationDefaults, type VideoModelRef } from '@xopcai/gateway-contract';

import { DurableState } from '../storage/sqlite/durable-state.js';

const settings = new DurableState<VideoModelRef>('video-generation');
const defaults = new DurableState<VideoGenerationDefaults>('video-generation-defaults');

export function getVideoModel(): VideoModelRef {
  const selected = settings.get('model');
  return selected && VIDEO_MODEL_REFS.includes(selected) ? selected : WAN_VIDEO_MODEL_REF;
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
