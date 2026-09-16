export interface XopcFileSpace { id: string; title: string; kind: string; writable: boolean; }
export interface XopcFileSpaces { spaces: XopcFileSpace[]; }
export interface XopcFile {
  id: string; spaceId: string; name: string; relativePath: string; parentPath: string;
  kind: string; mimeType: string; size: number; modifiedAt: number; revision: string; capabilities: string[];
}
export interface XopcFiles { items: XopcFile[]; }
export interface XopcFileResult { resource: XopcFile; }
export interface XopcFileWrite { content: string; revision: string; }
export interface XopcTransferAuth { origin: string; token: string; }
