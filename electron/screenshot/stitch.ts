export interface RgbaFrame {
  width: number;
  height: number;
  /** Row-major RGBA bytes (`width * height * 4`). */
  data: Uint8Array;
}

export interface ScrollStitchStepResult {
  accepted: boolean;
  appendedRows: number;
  totalHeight: number;
  reachedLimit: boolean;
  reason?: 'first_frame' | 'appended' | 'no_motion' | 'low_confidence' | 'size_mismatch' | 'max_height';
}

const SAMPLE_COLUMNS = 24;
const ROW_DIFF_IDENTICAL_THRESHOLD = 4.5;
const MATCH_CONFIDENCE_THRESHOLD = 18.0;

function computeSampleColumns(width: number): number[] {
  // Exclude rightmost 5% (up to 28px) to ignore moving scrollbar thumbs, and leftmost 2% border.
  const leftMargin = Math.min(12, Math.floor(width * 0.02));
  const rightMargin = Math.min(28, Math.floor(width * 0.05));
  const usable = Math.max(1, width - leftMargin - rightMargin);
  const count = Math.min(SAMPLE_COLUMNS, usable);
  const cols: number[] = [];
  for (let i = 0; i < count; i += 1) {
    cols.push(leftMargin + Math.floor(((i + 0.5) * usable) / count));
  }
  return cols;
}

function extractRowFeatures(frame: RgbaFrame, cols: readonly number[]): Float32Array {
  const features = new Float32Array(frame.height * cols.length * 3);
  const stride = frame.width * 4;
  let out = 0;
  for (let y = 0; y < frame.height; y += 1) {
    const rowOffset = y * stride;
    for (let i = 0; i < cols.length; i += 1) {
      const px = rowOffset + cols[i]! * 4;
      features[out++] = frame.data[px]!;
      features[out++] = frame.data[px + 1]!;
      features[out++] = frame.data[px + 2]!;
    }
  }
  return features;
}

function rowMeanAbsDiff(
  featA: Float32Array,
  rowA: number,
  featB: Float32Array,
  rowB: number,
  featureWidth: number,
): number {
  const offA = rowA * featureWidth;
  const offB = rowB * featureWidth;
  let sum = 0;
  for (let i = 0; i < featureWidth; i += 1) {
    sum += Math.abs(featA[offA + i]! - featB[offB + i]!);
  }
  return sum / featureWidth;
}

function detectFixedMargins(
  prevFeat: Float32Array,
  currFeat: Float32Array,
  height: number,
  featureWidth: number,
): { topFixed: number; bottomFixed: number } {
  const maxFixed = Math.floor(height * 0.32);
  let topFixed = 0;
  while (
    topFixed < maxFixed &&
    rowMeanAbsDiff(prevFeat, topFixed, currFeat, topFixed, featureWidth) <= ROW_DIFF_IDENTICAL_THRESHOLD
  ) {
    topFixed += 1;
  }

  let bottomFixed = 0;
  while (
    bottomFixed < maxFixed &&
    height - 1 - bottomFixed > topFixed + 24 &&
    rowMeanAbsDiff(prevFeat, height - 1 - bottomFixed, currFeat, height - 1 - bottomFixed, featureWidth) <=
      ROW_DIFF_IDENTICAL_THRESHOLD
  ) {
    bottomFixed += 1;
  }

  return { topFixed, bottomFixed };
}

/**
 * Stateful vertical screenshot stitcher supporting sticky headers/footers and HiDPI RGBA buffers.
 */
export class ScrollStitcher {
  private width = 0;
  private singleFrameHeight = 0;
  private sampleCols: number[] = [];
  private prevFrame: RgbaFrame | null = null;
  private prevFeatures: Float32Array | null = null;
  private chunks: Uint8Array[] = [];
  private footerChunk: Uint8Array | null = null;
  private stitchedBodyRows = 0;
  private footerRows = 0;
  private acceptedFrames = 0;

  constructor(private readonly maxHeight = 16_384) {}

  get frameCount(): number {
    return this.acceptedFrames;
  }

  get dimensions(): { width: number; height: number } {
    return {
      width: this.width,
      height: this.stitchedBodyRows + this.footerRows,
    };
  }

  pushFrame(frame: RgbaFrame): ScrollStitchStepResult {
    if (frame.width < 16 || frame.height < 32 || frame.data.byteLength !== frame.width * frame.height * 4) {
      return {
        accepted: false,
        appendedRows: 0,
        totalHeight: this.dimensions.height,
        reachedLimit: false,
        reason: 'size_mismatch',
      };
    }

    if (!this.prevFrame) {
      this.width = frame.width;
      this.singleFrameHeight = frame.height;
      this.sampleCols = computeSampleColumns(frame.width);
      const copy = new Uint8Array(frame.data);
      this.prevFrame = { width: frame.width, height: frame.height, data: copy };
      this.prevFeatures = extractRowFeatures(this.prevFrame, this.sampleCols);
      this.chunks = [copy];
      this.stitchedBodyRows = frame.height;
      this.footerChunk = null;
      this.footerRows = 0;
      this.acceptedFrames = 1;
      return {
        accepted: true,
        appendedRows: frame.height,
        totalHeight: frame.height,
        reachedLimit: frame.height >= this.maxHeight,
        reason: 'first_frame',
      };
    }

    if (frame.width !== this.width || frame.height !== this.singleFrameHeight) {
      return {
        accepted: false,
        appendedRows: 0,
        totalHeight: this.dimensions.height,
        reachedLimit: false,
        reason: 'size_mismatch',
      };
    }

    if (this.dimensions.height >= this.maxHeight) {
      return {
        accepted: false,
        appendedRows: 0,
        totalHeight: this.dimensions.height,
        reachedLimit: true,
        reason: 'max_height',
      };
    }

    const featureWidth = this.sampleCols.length * 3;
    const currFeatures = extractRowFeatures(frame, this.sampleCols);

    // Check if the entire frame barely changed at all (no scroll movement yet).
    let wholeDiff = 0;
    const probeStep = Math.max(1, Math.floor(frame.height / 32));
    let probes = 0;
    for (let y = 0; y < frame.height; y += probeStep) {
      wholeDiff += rowMeanAbsDiff(this.prevFeatures!, y, currFeatures, y, featureWidth);
      probes += 1;
    }
    if (probes > 0 && wholeDiff / probes < 2.2) {
      return {
        accepted: false,
        appendedRows: 0,
        totalHeight: this.dimensions.height,
        reachedLimit: false,
        reason: 'no_motion',
      };
    }

    const { topFixed, bottomFixed } = detectFixedMargins(
      this.prevFeatures!,
      currFeatures,
      frame.height,
      featureWidth,
    );
    const bandStart = topFixed;
    const bandEnd = frame.height - bottomFixed;
    const bandHeight = bandEnd - bandStart;
    if (bandHeight < 24) {
      return {
        accepted: false,
        appendedRows: 0,
        totalHeight: this.dimensions.height,
        reachedLimit: false,
        reason: 'no_motion',
      };
    }

    const minShift = Math.max(4, Math.floor(bandHeight * 0.02));
    const maxShift = Math.floor(bandHeight * 0.85);
    let bestShift = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let shift = minShift; shift <= maxShift; shift += 1) {
      const overlap = bandHeight - shift;
      if (overlap < 16) break;
      const rowStride = Math.max(1, Math.floor(overlap / 28));
      let err = 0;
      let count = 0;
      for (let offset = 0; offset < overlap; offset += rowStride) {
        // Content scrolled UP by `shift`: row `bandStart + shift + offset` in prev matches `bandStart + offset` in curr.
        err += rowMeanAbsDiff(
          this.prevFeatures!,
          bandStart + shift + offset,
          currFeatures,
          bandStart + offset,
          featureWidth,
        );
        count += 1;
      }
      const meanErr = count > 0 ? err / count : Number.POSITIVE_INFINITY;
      if (meanErr < bestScore) {
        bestScore = meanErr;
        bestShift = shift;
      }
    }

    if (bestShift < minShift || bestScore > MATCH_CONFIDENCE_THRESHOLD) {
      return {
        accepted: false,
        appendedRows: 0,
        totalHeight: this.dimensions.height,
        reachedLimit: false,
        reason: 'low_confidence',
      };
    }

    const rowBytes = this.width * 4;

    // On first detected sticky footer, trim the previous bottom fixed rows from the body and store footer separately.
    if (bottomFixed > 0 && this.footerRows === 0 && this.chunks.length === 1) {
      const first = this.chunks[0]!;
      const trimmedRows = frame.height - bottomFixed;
      this.chunks[0] = first.subarray(0, trimmedRows * rowBytes);
      this.stitchedBodyRows = trimmedRows;
    }

    const activeBottomFixed = Math.max(this.footerRows, bottomFixed);
    const activeBandEnd = frame.height - activeBottomFixed;
    const sliceStartRow = Math.max(bandStart, activeBandEnd - bestShift);
    const availableRows = Math.max(0, activeBandEnd - sliceStartRow);
    const maxAllowedAppend = Math.max(0, this.maxHeight - activeBottomFixed - this.stitchedBodyRows);
    const appendRows = Math.min(availableRows, maxAllowedAppend);

    if (appendRows <= 0) {
      return {
        accepted: false,
        appendedRows: 0,
        totalHeight: this.dimensions.height,
        reachedLimit: true,
        reason: 'max_height',
      };
    }

    const slice = frame.data.slice(sliceStartRow * rowBytes, (sliceStartRow + appendRows) * rowBytes);
    this.chunks.push(slice);
    this.stitchedBodyRows += appendRows;

    if (activeBottomFixed > 0) {
      this.footerRows = activeBottomFixed;
      this.footerChunk = frame.data.slice((frame.height - activeBottomFixed) * rowBytes, frame.height * rowBytes);
    }

    const nextCopy = new Uint8Array(frame.data);
    this.prevFrame = { width: frame.width, height: frame.height, data: nextCopy };
    this.prevFeatures = currFeatures;
    this.acceptedFrames += 1;

    const totalHeight = this.dimensions.height;
    const reachedLimit = totalHeight >= this.maxHeight;
    return {
      accepted: true,
      appendedRows: appendRows,
      totalHeight,
      reachedLimit,
      reason: 'appended',
    };
  }

  buildComposite(): RgbaFrame | null {
    if (!this.chunks.length || this.width <= 0) return null;
    const rowBytes = this.width * 4;
    const totalHeight = this.stitchedBodyRows + this.footerRows;
    const out = new Uint8Array(totalHeight * rowBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (this.footerChunk && this.footerRows > 0) {
      out.set(this.footerChunk, offset);
    }
    return {
      width: this.width,
      height: totalHeight,
      data: out,
    };
  }
}
