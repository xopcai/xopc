import { randomUUID } from 'node:crypto';

import {
  estimateVideoCostFen, VIDEO_AUTO_DURATION, isVideoDurationSupported, VIDEO_MODELS,
  type VideoGenerationDraft, type VideoRatio, type VideoResolution,
} from '@xopcai/gateway-contract';

import { getActiveTranscriptUserMedia, type TranscriptUserMessage } from '../agent/inbound/attachment-pipeline.js';
import type { MediaRef } from '../media/types.js';
import { getCloudMediaModels } from '../providers/xopc-cloud-media.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { getCurrentTranscriptId } from '../storage/sqlite/session-repository.js';
import { loadRecentUserTranscriptRows } from '../storage/sqlite/transcript-repository.js';
import { getVideoJob } from './repository.js';
import { getVideoDefaults, getVideoModel } from './settings.js';

const drafts = new DurableState<VideoGenerationDraft>('video-generation-drafts');
const supportedImage = (media: MediaRef) => media.uri.startsWith('media://') && /^image\/(png|jpeg|webp)$/i.test(media.mimeType);

export function getVideoDraft(conversationId: string, transcriptId: string): VideoGenerationDraft | undefined {
  const draft = drafts.get(conversationId);
  return draft?.transcriptId === transcriptId ? draft : undefined;
}

export function deleteVideoDraft(conversationId: string): void {
  drafts.delete(conversationId);
}

export function videoDraftImages(conversationId: string): { current: MediaRef[]; recent: MediaRef[] } {
  const turns = loadRecentUserTranscriptRows(conversationId, 20)
    .filter((row): row is TranscriptUserMessage => 'role' in row && row.role === 'user');
  const current = (getActiveTranscriptUserMedia(conversationId) ?? turns[0]?.media ?? []).filter(supportedImage);
  const images = [...current, ...turns.flatMap(turn => turn.media ?? []).filter(supportedImage)];
  return { current, recent: [...new Map(images.map(image => [image.uri, image])).values()] };
}

export function prepareVideoDraft(conversationId: string, input: {
  action: 'create' | 'update' | 'revise';
  prompt?: string;
  summary?: string;
  duration?: number;
  ratio?: VideoRatio;
  resolution?: VideoResolution;
  image?: 'current' | 'none';
  imageUri?: string;
}): VideoGenerationDraft {
  return drafts.update(conversationId, stored => {
    const transcriptId = getCurrentTranscriptId(conversationId);
    if (!transcriptId) throw new Error('The conversation is no longer available.');
    const previous = stored?.transcriptId === transcriptId ? stored : undefined;
    const job = previous && getVideoJob(conversationId, previous.id);
    if (input.action === 'update' && (!previous || job)) throw new Error('There is no pending draft to update.');
    if (input.action === 'revise' && !job) throw new Error('There is no submitted video to use as a starting point.');
    if (input.action === 'create' && previous && !job) throw new Error('A video draft is already pending. Update it instead.');
    const base = input.action === 'create' ? undefined : previous;
    const modelRef = getVideoModel();
    const model = VIDEO_MODELS[modelRef];
    const defaults = getVideoDefaults(modelRef);
    const prompt = (input.prompt ?? base?.prompt ?? '').trim();
    if (!prompt || prompt.length > 1_000) throw new Error('Provide a video description of 1–1000 characters.');
    const summary = input.summary?.trim() || (prompt === base?.prompt ? base.summary : undefined);
    const inherited = base?.modelRef === modelRef ? base : undefined;
    const duration = input.duration ?? inherited?.duration ?? defaults.duration;
    const resolution = input.resolution ?? inherited?.resolution ?? defaults.resolution;
    if (!isVideoDurationSupported(model, duration) || !model.resolutions.includes(resolution)) {
      throw new Error(`${model.name} supports ${model.minDuration}–${model.maxDuration} seconds or auto (-1) and ${model.resolutions.join(', ')}.`);
    }
    let imageUri = base?.imageUri ?? null;
    let imageName = base?.imageName ?? null;
    if (input.image === 'none') {
      imageUri = null;
      imageName = null;
    } else if (input.imageUri || input.image === 'current' || !base) {
      const images = videoDraftImages(conversationId);
      const current = [...new Map(images.current.map(image => [image.uri, image])).values()];
      if (!input.imageUri && current.length > 1) throw new Error('Multiple images were attached. Ask which image to use.');
      const image = input.imageUri ? images.recent.find(candidate => candidate.uri === input.imageUri) : current[0];
      if (!image && (input.imageUri || input.image === 'current')) throw new Error('That reference image is unavailable. Ask for an image from this conversation.');
      imageUri = image?.uri ?? null;
      imageName = image?.name ?? null;
    }
    const inheritedRatio = inherited?.ratio;
    const ratio = input.ratio ?? (imageUri
      ? (inheritedRatio && model.imageRatios.includes(inheritedRatio) ? inheritedRatio : model.imageRatios[0])
      : inheritedRatio === '9:16' ? '9:16' : '16:9');
    if ((imageUri && !model.imageRatios.includes(ratio)) || (!imageUri && ratio === 'adaptive')) {
      throw new Error(imageUri ? `${model.name} supports these first-frame ratios: ${model.imageRatios.join(', ')}.` : 'Choose 16:9 or 9:16 for a text-only video.');
    }
    const price = getCloudMediaModels('video').find(item => `xopc-cloud/${item.id}` === modelRef)?.prices[resolution];
    const estimatedCreditMicro = price && price * (duration === VIDEO_AUTO_DURATION ? model.maxDuration : duration);
    const updating = input.action === 'update';
    const draft: VideoGenerationDraft = {
      id: updating ? base!.id : randomUUID(), revision: updating ? base!.revision + 1 : 1,
      transcriptId, modelRef, prompt, summary, duration, resolution, ratio, imageUri, imageName,
      estimatedCostFen: estimateVideoCostFen(modelRef, duration, resolution),
      ...(estimatedCreditMicro ? { estimatedCreditMicro } : {}),
      createdAt: updating ? base!.createdAt : Date.now(),
    };
    return { value: draft, result: draft };
  });
}
