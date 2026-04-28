/**
 * Browser copy of `src/extensions/when-expression.ts` (Phase 2) — keep in sync manually.
 */

export type WhenContext = Record<string, unknown>;

type Tok =
  | { k: 'AND' }
  | { k: 'OR' }
  | { k: 'NOT' }
  | { k: 'EQ' }
  | { k: 'NE' }
  | { k: 'LP' }
  | { k: 'RP' }
  | { k: 'IDENT'; v: string }
  | { k: 'STR'; v: string }
  | { k: 'NUM'; v: number }
  | { k: 'BOOL'; v: boolean }
  | { k: 'EOF' };

function tokenize(input: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (s.slice(i, i + 2) === '&&') {
      out.push({ k: 'AND' });
      i += 2;
      continue;
    }
    if (s.slice(i, i + 2) === '||') {
      out.push({ k: 'OR' });
      i += 2;
      continue;
    }
    if (s.slice(i, i + 2) === '==') {
      out.push({ k: 'EQ' });
      i += 2;
      continue;
    }
    if (s.slice(i, i + 2) === '!=') {
      out.push({ k: 'NE' });
      i += 2;
      continue;
    }
    if (c === '(') {
      out.push({ k: 'LP' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ k: 'RP' });
      i++;
      continue;
    }
    if (c === '!') {
      out.push({ k: 'NOT' });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      let buf = '';
      while (i < s.length) {
        const ch = s[i];
        if (ch === '\\' && i + 1 < s.length) {
          buf += s[i + 1];
          i += 2;
          continue;
        }
        if (ch === q) {
          i++;
          break;
        }
        buf += ch;
        i++;
      }
      out.push({ k: 'STR', v: buf });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && i + 1 < s.length && /[0-9]/.test(s[i + 1]))) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const n = Number(s.slice(i, j));
      out.push({ k: 'NUM', v: Number.isFinite(n) ? n : 0 });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_.]/.test(s[j])) j++;
      const word = s.slice(i, j);
      i = j;
      if (word === 'true') out.push({ k: 'BOOL', v: true });
      else if (word === 'false') out.push({ k: 'BOOL', v: false });
      else out.push({ k: 'IDENT', v: word });
      continue;
    }
    throw new Error(`Unexpected character in when-expression at ${i}: ${c}`);
  }
  out.push({ k: 'EOF' });
  return out;
}

function ctxLookup(ctx: WhenContext, key: string): unknown {
  if (key in ctx) return ctx[key];
  return undefined;
}

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly ctx: WhenContext,
  ) {}

  parse(): boolean {
    const v = this.parseOr();
    const tail = this.cur();
    if (tail.k !== 'EOF') {
      throw new Error(
        `Unexpected tokens after expression (at ${this.i}: ${tail.k}${'v' in tail ? ` ${(tail as { v: unknown }).v}` : ''})`,
      );
    }
    return v;
  }

  private cur(): Tok {
    return this.toks[this.i] ?? { k: 'EOF' };
  }

  private parseOr(): boolean {
    let v = this.parseAnd();
    while (this.cur().k === 'OR') {
      this.i++;
      const rhs = this.parseAnd();
      v = v || rhs;
    }
    return v;
  }

  private parseAnd(): boolean {
    let v = this.parseUnary();
    while (this.cur().k === 'AND') {
      this.i++;
      const rhs = this.parseUnary();
      v = v && rhs;
    }
    return v;
  }

  private parseUnary(): boolean {
    if (this.cur().k === 'NOT') {
      this.i++;
      return !this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): boolean {
    const t = this.cur();
    if (t.k === 'LP') {
      this.i++;
      const inner = this.parseOr();
      if (this.cur().k !== 'RP') throw new Error('Expected )');
      this.i++;
      return inner;
    }
    return this.parseAtom();
  }

  private parseAtom(): boolean {
    const left = this.readAtomValue();
    const op = this.cur();
    if (op.k === 'EQ' || op.k === 'NE') {
      this.i++;
      const right = this.readAtomValue();
      const eq = valuesLooselyEqual(left, right);
      return op.k === 'EQ' ? eq : !eq;
    }
    return isTruthyWhen(left);
  }

  private readAtomValue(): unknown {
    const t = this.cur();
    if (t.k === 'IDENT') {
      this.i++;
      return ctxLookup(this.ctx, t.v);
    }
    if (t.k === 'STR') {
      this.i++;
      return t.v;
    }
    if (t.k === 'NUM') {
      this.i++;
      return t.v;
    }
    if (t.k === 'BOOL') {
      this.i++;
      return t.v;
    }
    throw new Error('Expected value in when-expression');
  }
}

function valuesLooselyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a) === String(b);
}

function isTruthyWhen(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return v != null;
}

export function evaluateWhenExpression(expr: string, ctx: WhenContext): boolean {
  const s = expr.trim();
  if (!s) return true;
  const toks = tokenize(s);
  return new Parser(toks, ctx).parse();
}

/** Safe wrapper: missing or empty `when` → visible. */
export function evaluateWhen(when: string | undefined, ctx: WhenContext): boolean {
  if (!when?.trim()) return true;
  try {
    return evaluateWhenExpression(when, ctx);
  } catch {
    return true;
  }
}
