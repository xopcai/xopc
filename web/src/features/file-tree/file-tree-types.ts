export interface TreeEntry {
  name: string;
  path: string;
  /** Host absolute path when provided by the gateway (copy path). */
  absolutePath?: string;
  isDirectory: boolean;
  children?: TreeEntry[];
}

export type FileTreeAction =
  | 'preview'
  | 'download'
  | 'copyPath'
  | 'share'
  | 'openDefault'
  | 'openWith'
  | 'openWithApp'
  | 'revealInFolder';
