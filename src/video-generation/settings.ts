import { VIDEO_MODEL_REFS, VIDEO_MODELS, LOCAL_VIDEO_MODEL_REFS, isVideoDurationSupported, WAN_VIDEO_MODEL_REF, type VideoGenerationDefaults, type VideoModelRef } from '@xopcai/gateway-contract';

import { getCloudMediaDefault, getCloudMediaModels } from '../providers/xopc-cloud-media.js';
import { DurableState } from '../storage/sqlite/durable-state.js';

const settings = new DurableState<VideoModelRef>('video-generation');
const defaults = new DurableState<VideoGenerationDefaults>('video-generation-defaults');

export function storedVideoModel(): VideoModelRef | undefined {
  return settings.get('model');
}

export function getVideoModel(): VideoModelRef {
  const selected = storedVideoModel();
  const cloud = getCloudMediaDefault('video');
  if (selected && VIDEO_MODEL_REFS.includes(selected)) {
    if (cloud === 'xopc-cloud/video' && selected.startsWith('xopc-cloud/')
      && !getCloudMediaModels('video').some(item => `xopc-cloud/${item.id}` === selected)) return cloud;
    return selected;
  }
  return VIDEO_MODEL_REFS.find(ref => ref === cloud) ?? WAN_VIDEO_MODEL_REF;
}

export function setVideoModel(modelRef: VideoModelRef): void {
  settings.set('model', modelRef);
}

export function getVideoModelDefinition(ref: VideoModelRef) {
  const model = VIDEO_MODELS[ref];
  if (model.provider !== 'xopc-cloud') return model;
  const source = getCloudMediaModels('video').find(item => `xopc-cloud/${item.id}` === ref);
  const localRef = LOCAL_VIDEO_MODEL_REFS.find(item => item === source?.sourceRef);
  return localRef ? { ...VIDEO_MODELS[localRef], provider: model.provider, name: source!.name } : model;
}

export function getVideoDefaults(modelRef: VideoModelRef): VideoGenerationDefaults {
  const model = getVideoModelDefinition(modelRef);
  const saved = defaults.get(modelRef);
  return {
    duration: saved && isVideoDurationSupported(model, saved.duration) ? saved.duration : 5,
    resolution: saved && model.resolutions.includes(saved.resolution) ? saved.resolution : '720P',
  };
}

export function setVideoDefaults(modelRef: VideoModelRef, value: VideoGenerationDefaults): void {
  defaults.set(modelRef, value);
}
