export type MathDelimiter = 'paren' | 'dollar' | 'bracket' | 'double-dollar' | 'math-fence';
export interface MathSource {
  raw: string;
  latex: string;
  display: boolean;
  delimiter: MathDelimiter;
  state: 'pending' | 'complete';
  range: { start: number; end: number };
}
export interface MathRenderContext { streaming: boolean; }
export type MathRenderResult =
  | { status: 'ready'; html: string }
  | { status: 'pending' }
  | { status: 'fallback'; reason: 'invalid' | 'limit'; source: string };
