export type GlobalHitKind = 'extension' | 'route' | 'session' | 'file' | 'command' | 'skill';

export type GlobalHit = {
  kind: GlobalHitKind;
  id: string;
  title: string;
  subtitle?: string;
  /** Lower is better. */
  rank: number;
  groupLabel: string;
  /** Used for secondary matching (aliases, path, etc.). */
  keywords?: string[];
  /** Execute the hit. */
  run: () => void;
};

