export interface DecodedPcmAudio {
  samples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
}

function readChunkId(buffer: Buffer, offset: number): string {
  return buffer.toString('ascii', offset, offset + 4);
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input;
  const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i += 1) {
    const sourcePosition = i * ratio;
    const left = Math.min(input.length - 1, Math.floor(sourcePosition));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = sourcePosition - left;
    output[i] = input[left]! * (1 - fraction) + input[right]! * fraction;
  }
  return output;
}

export function decodeWavToMonoFloat32(buffer: Buffer, targetRate = 16_000): DecodedPcmAudio {
  if (buffer.length < 44 || readChunkId(buffer, 0) !== 'RIFF' || readChunkId(buffer, 8) !== 'WAVE') {
    throw new Error('Local STT currently requires PCM WAV audio');
  }

  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = readChunkId(buffer, offset);
    const length = buffer.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;
    if (bodyOffset + length > buffer.length) break;
    if (id === 'fmt ' && length >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(bodyOffset),
        channels: buffer.readUInt16LE(bodyOffset + 2),
        sampleRate: buffer.readUInt32LE(bodyOffset + 4),
        bitsPerSample: buffer.readUInt16LE(bodyOffset + 14),
      };
    } else if (id === 'data') {
      dataOffset = bodyOffset;
      dataLength = length;
      break;
    }
    offset = bodyOffset + length + (length % 2);
  }

  if (!format || dataOffset < 0 || dataLength === 0) {
    throw new Error('WAV audio is missing format or data chunks');
  }
  if (format.channels < 1 || format.channels > 8 || format.sampleRate < 8_000) {
    throw new Error('Unsupported WAV channel count or sample rate');
  }
  const bytesPerSample = format.bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample < 2) {
    throw new Error(`Unsupported WAV bit depth: ${format.bitsPerSample}`);
  }
  const frameBytes = bytesPerSample * format.channels;
  const frameCount = Math.floor(dataLength / frameBytes);
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      const sampleOffset = dataOffset + frame * frameBytes + channel * bytesPerSample;
      if (format.audioFormat === 1 && format.bitsPerSample === 16) {
        sum += buffer.readInt16LE(sampleOffset) / 32768;
      } else if (format.audioFormat === 3 && format.bitsPerSample === 32) {
        sum += buffer.readFloatLE(sampleOffset);
      } else {
        throw new Error(`Unsupported WAV encoding: format ${format.audioFormat}, ${format.bitsPerSample}-bit`);
      }
    }
    mono[frame] = Math.max(-1, Math.min(1, sum / format.channels));
  }

  const samples = resampleLinear(mono, format.sampleRate, targetRate);
  return {
    samples,
    sampleRate: targetRate,
    durationSeconds: frameCount / format.sampleRate,
  };
}
