export const configure: (surfaceId: string, width: number, height: number) => boolean;
export const push: (bytes: ArrayBuffer, pts: number, flags: number) => boolean;
export const stop: () => void;
export const frames: () => number;
