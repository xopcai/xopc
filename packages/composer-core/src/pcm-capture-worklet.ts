declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][]): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

const WORKLET_NAME = 'xopc-pcm-capture';

class XopcPcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly buffer: Float32Array;
  private offset = 0;

  constructor(options?: { processorOptions?: { frameSamples?: number } }) {
    super();
    const frameSamples = options?.processorOptions?.frameSamples;
    this.buffer = new Float32Array(frameSamples && Number.isInteger(frameSamples) && frameSamples > 0 && frameSamples <= 4096
      ? frameSamples : 2048);
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  private flush(): void {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.offset = 0;
    this.port.postMessage({ type: 'samples', buffer: samples.buffer }, [samples.buffer]);
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    let sourceOffset = 0;
    while (sourceOffset < channel.length) {
      const count = Math.min(channel.length - sourceOffset, this.buffer.length - this.offset);
      this.buffer.set(channel.subarray(sourceOffset, sourceOffset + count), this.offset);
      this.offset += count;
      sourceOffset += count;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}

registerProcessor(WORKLET_NAME, XopcPcmCaptureProcessor);
