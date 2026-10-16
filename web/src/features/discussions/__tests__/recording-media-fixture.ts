export const element = (id: number[], data: number[]) => [...id, ...(data.length < 127 ? [0x80 | data.length] : [0x40 | (data.length >> 8), data.length & 255]), ...data];
const entry = element([0xae], [...element([0xd7], [1]), ...element([0x83], [2]), ...element([0x86], [...new TextEncoder().encode('A_OPUS')])]);
export const mediaHeader = [...[0x18, 0x53, 0x80, 0x67, 0xff], ...element([0x16, 0x54, 0xae, 0x6b], entry)];
export const mediaCluster = (time: number, flags = 0, packet = [0xf8, 0]) => element([0x1f, 0x43, 0xb6, 0x75], [
  ...element([0xe7], [(time >>> 16) & 255, (time >>> 8) & 255, time & 255]), ...element([0xa3], [0x81, 0, 0, flags, ...packet]),
]);
