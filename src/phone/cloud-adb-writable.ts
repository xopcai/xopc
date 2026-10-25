import { Consumable, WritableStream } from '@yume-chan/stream-extra';

/** Observe consumption even when a failed write prevents the producer from awaiting it. */
export function observeAdbConsumption<T>(stream: WritableStream<Consumable<T>>): WritableStream<Consumable<T>> {
  const writer = stream.getWriter();
  void writer.closed.catch(() => {});
  return new WritableStream<Consumable<T>>({
    write(chunk) {
      void chunk.consumed.catch(() => {});
      return writer.write(chunk);
    },
    close() { return writer.close(); },
    abort(reason) { return writer.abort(reason); },
  });
}
