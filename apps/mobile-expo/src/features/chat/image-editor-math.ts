export type ImageSize = {
  width: number;
  height: number;
};

export type CropTransform = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type CropRect = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export function fitCropFrame(container: ImageSize, aspect: number, inset = 16): ImageSize {
  const availableWidth = Math.max(0, container.width - inset * 2);
  const availableHeight = Math.max(0, container.height - inset * 2);
  if (!availableWidth || !availableHeight || !Number.isFinite(aspect) || aspect <= 0) {
    return { width: 0, height: 0 };
  }
  if (availableWidth / availableHeight > aspect) {
    return { width: availableHeight * aspect, height: availableHeight };
  }
  return { width: availableWidth, height: availableWidth / aspect };
}

export function coverImageSize(source: ImageSize, frame: ImageSize): ImageSize {
  if (!source.width || !source.height || !frame.width || !frame.height) {
    return { width: 0, height: 0 };
  }
  const scale = Math.max(frame.width / source.width, frame.height / source.height);
  return { width: source.width * scale, height: source.height * scale };
}

export function translationBounds(baseImage: ImageSize, frame: ImageSize, zoom: number): ImageSize {
  return {
    width: Math.max(0, (baseImage.width * zoom - frame.width) / 2),
    height: Math.max(0, (baseImage.height * zoom - frame.height) / 2),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cropRectForTransform(
  source: ImageSize,
  frame: ImageSize,
  transform: CropTransform,
): CropRect {
  const base = coverImageSize(source, frame);
  const scale = source.width > 0 ? (base.width / source.width) * Math.max(1, transform.zoom) : 1;
  const rawWidth = clamp(frame.width / scale, 1, source.width);
  const rawHeight = clamp(frame.height / scale, 1, source.height);
  const rawX = (source.width - rawWidth) / 2 - transform.offsetX / scale;
  const rawY = (source.height - rawHeight) / 2 - transform.offsetY / scale;
  const originX = Math.round(clamp(rawX, 0, source.width - rawWidth));
  const originY = Math.round(clamp(rawY, 0, source.height - rawHeight));
  const width = Math.max(1, Math.min(Math.round(rawWidth), source.width - originX));
  const height = Math.max(1, Math.min(Math.round(rawHeight), source.height - originY));
  return { originX, originY, width, height };
}
