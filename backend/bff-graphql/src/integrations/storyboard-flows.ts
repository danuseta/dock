// The flows of a storyboard artifact, read from its script source without running it: SCENARIOS names each scenario's
// FLOWS and GROUPS arrays, and a flow carries its id (F1.4, F1.1b), title, tickets, info and frames. Values that are
// code, such as a frame's s:()=>... screen, are skipped by bracket matching.

export const FLOW_ID = /^F\d+\.\d+[a-z]?$/;
const TICKET = /\b[A-Z][A-Z0-9_]*-\d+\b/g;
const OTHER_GROUP = 'Other';

type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal } | Ref | undefined;
class Ref { constructor(readonly name: string) {} }

export interface ParsedFrame { title: string; step: string | null; notes: string[] }
export interface ParsedFlow { id: string; title: string; tickets: string[]; info: string[]; frames: ParsedFrame[] }
export interface ParsedScenario { n: number; title: string; groups: Array<{ title: string; flows: ParsedFlow[] }> }

export interface StoryboardFrameView { index: number; title: string; step: string | null; changed: boolean }
export interface StoryboardFlowView { id: string; title: string; tickets: string[]; info: string[]; frames: StoryboardFrameView[]; changed: boolean }
export interface StoryboardGroup { title: string; flows: StoryboardFlowView[] }
export interface StoryboardScenario { n: number; title: string; groups: StoryboardGroup[] }

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;
const REGEX_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

class Scanner {
  pos: number;
  constructor(private readonly src: string, start: number, private readonly spread: (name: string) => Literal[] = () => []) { this.pos = start; }

  private peek(offset = 0) { return this.src[this.pos + offset] ?? ''; }

  ws(): void {
    for (;;) {
      const c = this.peek();
      if (c === '/' && this.peek(1) === '/') { const end = this.src.indexOf('\n', this.pos); this.pos = end < 0 ? this.src.length : end + 1; continue; }
      if (c === '/' && this.peek(1) === '*') { const end = this.src.indexOf('*/', this.pos + 2); this.pos = end < 0 ? this.src.length : end + 2; continue; }
      if (c && /\s/.test(c)) { this.pos += 1; continue; }
      return;
    }
  }

  private ident(): string {
    const start = this.pos;
    if (!IDENT_START.test(this.peek())) return '';
    while (IDENT.test(this.peek())) this.pos += 1;
    return this.src.slice(start, this.pos);
  }

  private escape(): string {
    const c = this.src[this.pos++] ?? '';
    const hex = (length: number) => { const code = parseInt(this.src.slice(this.pos, this.pos + length), 16); this.pos += length; return Number.isNaN(code) ? '' : String.fromCodePoint(code); };
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '0': return '\0';
      case 'x': return hex(2);
      case 'u': {
        if (this.peek() !== '{') return hex(4);
        const end = this.src.indexOf('}', this.pos);
        const code = parseInt(this.src.slice(this.pos + 1, end), 16);
        this.pos = end + 1;
        return Number.isNaN(code) ? '' : String.fromCodePoint(code);
      }
      case '\r': if (this.peek() === '\n') this.pos += 1; return '';
      case '\n': case ' ': case ' ': return '';
      default: return c;
    }
  }

  private string(): string {
    const quote = this.src[this.pos++];
    let out = '';
    while (this.pos < this.src.length) {
      const c = this.src[this.pos++];
      if (c === quote) return out;
      out += c === '\\' ? this.escape() : c;
    }
    return out;
  }

  /** A template literal's text; each ${...} is skipped and stands as "…". */
  private template(): string {
    this.pos += 1;
    let out = '';
    while (this.pos < this.src.length) {
      const c = this.src[this.pos++];
      if (c === '`') return out;
      if (c === '\\') { out += this.escape(); continue; }
      if (c === '$' && this.peek() === '{') { this.pos += 1; this.balanced('}'); out += '…'; continue; }
      out += c;
    }
    return out;
  }

  private regex(): void {
    this.pos += 1;
    let inClass = false;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos++];
      if (c === '\\') { this.pos += 1; continue; }
      if (c === '\n') return;
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
    }
    while (IDENT.test(this.peek())) this.pos += 1;
  }

  /** Skips code until the closing character at depth 0 (consumed), or, with no closer, until , ] } ) ; at depth 0 (not consumed). */
  private balanced(closer: string | null): void {
    let depth = 0;
    let prev = '';
    while (this.pos < this.src.length) {
      const c = this.peek();
      if (c === '/' && (this.peek(1) === '/' || this.peek(1) === '*')) { this.ws(); continue; }
      if (/\s/.test(c)) { this.pos += 1; continue; }
      if (c === '"' || c === "'") { this.string(); prev = 'a'; continue; }
      if (c === '`') { this.template(); prev = 'a'; continue; }
      if (c === '/' && REGEX_BEFORE.has(prev)) { this.regex(); prev = 'a'; continue; }
      if (c === '(' || c === '[' || c === '{') { depth += 1; this.pos += 1; prev = c; continue; }
      if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) {
          if (closer === c) this.pos += 1;
          return;
        }
        depth -= 1;
        this.pos += 1;
        prev = c === '}' ? '}' : 'a';
        continue;
      }
      if (depth === 0 && closer === null && (c === ',' || c === ';')) return;
      if (IDENT_START.test(c) || /\d/.test(c)) {
        const word = this.ident() || (this.pos += 1, 'a');
        prev = word === 'return' || word === 'typeof' ? '(' : 'a';
        continue;
      }
      this.pos += 1;
      prev = c;
    }
  }

  private skipExpression(): void { this.balanced(null); }

  private atEnd(): boolean {
    this.ws();
    const c = this.peek();
    return c === '' || c === ',' || c === ']' || c === '}' || c === ')' || c === ';';
  }

  value(): Literal {
    this.ws();
    const start = this.pos;
    const c = this.peek();
    let value: Literal;
    if (c === '"' || c === "'") value = this.string();
    else if (c === '`') value = this.template();
    else if (c === '[') value = this.array();
    else if (c === '{') value = this.object();
    else if (/[\d.-]/.test(c) && /[\d.]/.test(c === '-' ? this.peek(1) : c)) {
      const match = /^-?(?:\d[\d_]*)?(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(this.src.slice(this.pos, this.pos + 40))!;
      this.pos += match[0].length;
      value = Number(match[0].replace(/_/g, ''));
    } else if (IDENT_START.test(c)) {
      const word = this.ident();
      value = word === 'true' ? true : word === 'false' ? false : word === 'null' ? null : word === 'undefined' || word === 'function' ? undefined : new Ref(word);
    } else {
      value = undefined;
    }
    if (this.atEnd()) return value;
    this.pos = start;
    this.skipExpression();
    return undefined;
  }

  private array(): Literal[] {
    this.pos += 1;
    const out: Literal[] = [];
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === '') return out;
      if (c === ']') { this.pos += 1; return out; }
      if (c === ',') { this.pos += 1; continue; }
      if (this.src.startsWith('...', this.pos)) { out.push(...this.spreadCall()); continue; }
      out.push(this.value());
      this.ws();
      if (this.peek() !== ',' && this.peek() !== ']') this.skipExpression();
    }
  }

  /** `...NAME(args)` where NAME returns an array literal, such as shared opening frames; any other spread is skipped. */
  private spreadCall(): Literal[] {
    this.pos += 3;
    this.ws();
    const start = this.pos;
    const name = this.ident();
    this.ws();
    if (name && this.peek() === '(') {
      this.pos += 1;
      this.balanced(')');
      if (this.atEnd()) return this.spread(name);
    }
    this.pos = start;
    this.skipExpression();
    return [];
  }

  private object(): { [key: string]: Literal } {
    this.pos += 1;
    const out: { [key: string]: Literal } = {};
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === '') return out;
      if (c === '}') { this.pos += 1; return out; }
      if (c === ',') { this.pos += 1; continue; }
      if (this.src.startsWith('...', this.pos)) { this.pos += 3; this.skipExpression(); continue; }
      let key: string | null = null;
      if (c === '"' || c === "'") key = this.string();
      else if (c === '[') { this.pos += 1; this.balanced(']'); }
      else key = this.ident() || null;
      if (key === null && c !== '[') { this.skipExpression(); continue; }
      this.ws();
      if (this.peek() === ':') {
        this.pos += 1;
        const value = this.value();
        if (key !== null) out[key] = value;
      } else {
        // A shorthand property or a method: code either way.
        this.skipExpression();
      }
    }
  }
}

const declaration = (src: string, name: string) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*`).exec(src);

const MAX_SPREAD_DEPTH = 4;

/** The value a top-level `const NAME = ...` holds, or undefined when the source has no such declaration. */
export function literalOf(src: string, name: string, depth = 0): Literal {
  const match = declaration(src, name);
  return match ? new Scanner(src, match.index + match[0].length, (fn) => arrayReturnedBy(src, fn, depth + 1)).value() : undefined;
}

/** The array literal an arrow function `const NAME = (...) => [...]` returns; its parameters read as unknown. */
function arrayReturnedBy(src: string, name: string, depth: number): Literal[] {
  const match = depth <= MAX_SPREAD_DEPTH ? declaration(src, name) : null;
  if (!match) return [];
  const start = match.index + match[0].length;
  const arrow = /^(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?=\[)/.exec(src.slice(start, start + 400));
  if (!arrow) return [];
  const value = new Scanner(src, start + arrow[0].length, (fn) => arrayReturnedBy(src, fn, depth + 1)).value();
  return Array.isArray(value) ? value : [];
}

const isRecord = (value: Literal): value is { [key: string]: Literal } => !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Ref);
const text = (value: Literal): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : typeof value === 'number' ? String(value) : '');
const list = (value: Literal): Literal[] => (Array.isArray(value) ? value : []);

function noteText(note: Literal): string {
  if (typeof note === 'string') return text(note);
  if (Array.isArray(note)) return text(note.find((item) => typeof item === 'string'));
  if (isRecord(note)) return text(note.text);
  return '';
}

function ticketsOf(value: Literal): string[] {
  const raw = Array.isArray(value) ? value.map(text).join(' ') : text(value);
  return [...new Set(raw.toUpperCase().match(TICKET) ?? [])];
}

function flowOf(value: Literal): ParsedFlow | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!FLOW_ID.test(id)) return null;
  return {
    id,
    title: text(value.title),
    tickets: ticketsOf(value.tickets),
    info: list(value.info).map(text),
    frames: list(value.frames).filter(isRecord).map((frame) => ({
      title: text(frame.t ?? frame.title),
      step: text(frame.step) || null,
      notes: list(frame.notes).map(noteText).filter(Boolean),
    })),
  };
}

/** The scenarios of a storyboard artifact, each with its flows in group order; flows no group names go last under "Other". */
export function parseStoryboard(html: string): ParsedScenario[] {
  const cache = new Map<string, Literal>();
  const resolve = (value: Literal): Literal => {
    if (!(value instanceof Ref)) return value;
    if (!cache.has(value.name)) cache.set(value.name, literalOf(html, value.name));
    return cache.get(value.name);
  };
  return list(resolve(new Ref('SCENARIOS'))).filter(isRecord).map((scenario, index) => {
    const flows = list(resolve(scenario.flows)).map(flowOf).filter((flow): flow is ParsedFlow => !!flow);
    const byId = new Map(flows.map((flow) => [flow.id, flow]));
    const placed = new Set<string>();
    const groups = list(resolve(scenario.groups)).filter(isRecord).map((group) => ({
      title: text(group.title) || text(group.id),
      flows: list(group.flows).map((id) => byId.get(text(id))).filter((flow): flow is ParsedFlow => !!flow && !placed.has(flow.id) && !!placed.add(flow.id)),
    })).filter((group) => group.flows.length);
    const rest = flows.filter((flow) => !placed.has(flow.id));
    if (rest.length) groups.push({ title: OTHER_GROUP, flows: rest });
    const n = typeof scenario.n === 'number' ? scenario.n : index + 1;
    return { n, title: text(scenario.title) || `Scenario ${n}`, groups };
  });
}

export const flowsOf = (scenarios: ParsedScenario[]): ParsedFlow[] => scenarios.flatMap((scenario) => scenario.groups.flatMap((group) => group.flows));
const frameKey = (frame: ParsedFrame | undefined) => (frame ? JSON.stringify([frame.title, frame.step, frame.notes]) : '');

export interface StoryboardComparison {
  scenarios: StoryboardScenario[];
  /** Flow ids that changed, were added or were removed since the previous version. */
  changed: string[];
  /** The tickets each changed flow lists, from the newest version or, for a removed flow, the previous one. */
  tickets: Record<string, string[]>;
}

/** Compares each flow frame by frame (title, step and notes); without a previous version that has flows, nothing changed. */
export function compareStoryboards(before: ParsedScenario[] | null, after: ParsedScenario[]): StoryboardComparison {
  const old = new Map(flowsOf(before ?? []).map((flow) => [flow.id, flow]));
  const compare = old.size > 0;
  const changed: string[] = [];
  const tickets: Record<string, string[]> = {};
  const scenarios = after.map((scenario) => ({
    n: scenario.n,
    title: scenario.title,
    groups: scenario.groups.map((group) => ({
      title: group.title,
      flows: group.flows.map((flow) => {
        const prior = old.get(flow.id);
        const frames = flow.frames.map((frame, index) => ({ index, title: frame.title, step: frame.step, changed: compare && frameKey(frame) !== frameKey(prior?.frames[index]) }));
        const flowChanged = compare && (!prior || prior.frames.length !== flow.frames.length || frames.some((frame) => frame.changed));
        if (flowChanged && !changed.includes(flow.id)) { changed.push(flow.id); tickets[flow.id] = flow.tickets; }
        return { id: flow.id, title: flow.title, tickets: flow.tickets, info: flow.info, frames, changed: flowChanged };
      }),
    })),
  }));
  const now = new Set(flowsOf(after).map((flow) => flow.id));
  for (const [id, flow] of old) if (!now.has(id)) { changed.push(id); tickets[id] = flow.tickets; }
  return { scenarios, changed, tickets };
}
