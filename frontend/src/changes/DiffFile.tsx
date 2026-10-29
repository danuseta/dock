import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { Check, ChevronDown, ChevronRight, ExternalLink, FileWarning, UnfoldVertical } from 'lucide-react';
import { GET_PULL_FILE_LINES } from '../graphql/queries';
import { Button, Checkbox } from '../components/ui';
import { cn } from '../lib/cn';
import { FindingCard } from './FindingCard';
import type { Anchor, ChangesFinding } from './findings';
import { LONG_FILE_LINES, gapBefore, hideWhitespace, hunkEnd, splitRows, type DiffLine, type Hunk } from './patch';
import type { DiffView } from './prefs';

export interface ChangeFile { path: string; previousPath: string | null; status: string; additions: number; deletions: number; patch: string | null; tooLarge: boolean }

/** Expand loads this many lines, or the whole gap when fewer than GAP_WHOLE are left. */
const EXPAND_STEP = 20;
const GAP_WHOLE = 60;

interface DiffFileProps {
  ticketKey: string;
  pullUrl: string;
  headSha: string;
  file: ChangeFile;
  hunks: Hunk[];
  view: DiffView;
  hideSpaces: boolean;
  findings: ChangesFinding[];
  anchors: Anchor[];
  placeOf: (anchor: Anchor) => number;
  total: number;
  onStep: (anchor: Anchor, delta: number) => void;
  viewed: boolean;
  onViewed: (viewed: boolean) => void;
  folded: boolean;
  onFold: (folded: boolean) => void;
  /** Loads the patch of a file the size guard sent without one. */
  onLoadPatch: () => Promise<void>;
}

/** Loaded unchanged lines per gap: gap i sits before hunk i and grows upwards; the gap after the last hunk grows downwards. */
interface Extra { lines: string[]; end: boolean }

const ROW = 'grid min-w-full w-max font-mono text-[0.74rem] leading-5 max-[760px]:text-xs';
const NUMBER = 'select-none px-2 text-right text-muted-foreground tabular-nums';
const KIND_STYLE: Record<DiffLine['kind'], string> = { context: '', add: 'bg-status-merged/[0.09]', del: 'bg-status-conflict/[0.09]' };
const SIGN: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '-' };

/** Renders its children once it has come near the screen; until then a block of about the same height. */
function useSeen(ref: React.RefObject<HTMLElement>) {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const node = ref.current;
    if (seen || !node) return undefined;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setSeen(true); }, { rootMargin: '800px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}

/** One file of the diff: its header, its hunks with the findings under their lines, Expand between hunks. */
export const DiffFile: React.FC<DiffFileProps> = (props) => {
  const { file, folded } = props;
  const ref = useRef<HTMLElement>(null);
  const seen = useSeen(ref);
  const changed = file.additions + file.deletions;
  const fileUrl = `${props.pullUrl}/files`;

  return (
    <section ref={ref} id={`file-${props.file.path}`} data-path={file.path} className="scroll-mt-28 overflow-hidden rounded-sm border border-border bg-background">
      <header className="sticky top-0 z-[2] flex min-w-0 items-center gap-2 border-b border-border bg-surface-0 px-3 py-2">
        <button type="button" aria-expanded={!folded} aria-label={folded ? `Show ${file.path}` : `Fold ${file.path}`} onClick={() => props.onFold(!folded)} className="grid size-6 flex-none place-items-center rounded-xs border-0 bg-transparent text-secondary-foreground hover:bg-surface-2 max-[760px]:size-11">
          {folded ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        <h3 className="min-w-0 flex-1 truncate font-mono text-[0.78rem] font-semibold max-[760px]:flex max-[760px]:flex-col-reverse" title={file.path}>
          {file.previousPath && <span className="text-muted-foreground">{file.previousPath} → </span>}<span className="max-[760px]:block max-[760px]:truncate max-[760px]:text-xs max-[760px]:font-normal max-[760px]:text-muted-foreground">{file.path.slice(0, file.path.lastIndexOf('/') + 1)}</span><span className="max-[760px]:block max-[760px]:truncate">{file.path.slice(file.path.lastIndexOf('/') + 1)}</span>
        </h3>
        <span className="flex-none font-mono text-[0.72rem] tabular-nums"><span className="text-status-merged">+{file.additions}</span> <span className="text-status-conflict">-{file.deletions}</span></span>
        <button type="button" aria-pressed={props.viewed} aria-label={`Viewed ${file.path}`} onClick={() => props.onViewed(!props.viewed)} className={cn('grid size-11 flex-none place-items-center rounded-xs border-0 bg-transparent min-[761px]:hidden', props.viewed ? 'text-status-merged' : 'text-secondary-foreground')}><Check size={18} aria-hidden="true" /></button>
        <label className="flex flex-none items-center gap-1.5 text-[0.72rem] text-secondary-foreground max-[760px]:hidden"><Checkbox checked={props.viewed} onChange={(event) => props.onViewed(event.target.checked)} />Viewed</label>
        <a href={fileUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.path} on GitHub`} className="grid size-6 flex-none place-items-center rounded-xs text-secondary-foreground hover:bg-surface-2 max-[760px]:size-11"><ExternalLink size={13} aria-hidden="true" /></a>
      </header>
      {!folded && (seen ? <Body {...props} changed={changed} fileUrl={fileUrl} /> : <div style={{ height: Math.min(Math.max(changed, 3) * 20, 4000) }} />)}
      {folded && !file.tooLarge && file.patch !== null && changed > LONG_FILE_LINES && (
        <p className="flex items-center gap-2 px-3 py-2.5 text-[0.76rem] text-secondary-foreground"><UnfoldVertical size={14} aria-hidden="true" />{changed} lines, folded because it is long.<Button size="sm" onClick={() => props.onFold(false)}>Load diff</Button></p>
      )}
    </section>
  );
};

const Body: React.FC<DiffFileProps & { changed: number; fileUrl: string }> = (props) => {
  const { file, hunks, view, hideSpaces, anchors } = props;
  const client = useApolloClient();
  const [extra, setExtra] = useState<Record<number, Extra>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);

  const shown = useMemo(() => hunks.map((hunk) => ({ ...hunk, lines: hideSpaces ? hideWhitespace(hunk.lines) : hunk.lines })), [hunks, hideSpaces]);

  if (file.tooLarge) {
    return (
      <p className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[0.76rem] text-secondary-foreground">
        <FileWarning size={14} className="text-status-warn" aria-hidden="true" />GitHub does not send a diff for a file this large.
        <a href={props.fileUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 font-display text-xs font-semibold text-foreground hover:border-border-glow max-[760px]:h-11"><ExternalLink size={13} aria-hidden="true" />Open on GitHub</a>
      </p>
    );
  }
  if (file.patch === null) {
    if (file.status === 'renamed') return <p className="px-3 py-2.5 text-[0.76rem] text-secondary-foreground">Renamed without changes.</p>;
    const load = async () => {
      setPatchLoading(true);
      try { await props.onLoadPatch(); } finally { setPatchLoading(false); }
    };
    return <p className="flex items-center gap-2 px-3 py-2.5 text-[0.76rem] text-secondary-foreground">This pull request is big, so this file loads on its own.<Button size="sm" onClick={() => void load()} disabled={patchLoading}>{patchLoading ? 'Loading' : 'Load diff'}</Button></p>;
  }

  const lastIndex = shown.length;
  const remaining = (gap: number) => (gap < lastIndex ? gapBefore(shown, gap) - (extra[gap]?.lines.length ?? 0) : extra[gap]?.end ? 0 : Infinity);

  const expand = async (gap: number) => {
    const loaded = extra[gap]?.lines ?? [];
    const left = remaining(gap);
    const count = left < GAP_WHOLE ? left : EXPAND_STEP;
    let from: number;
    let to: number;
    if (gap < lastIndex) {
      to = shown[gap].newStart - 1 - loaded.length;
      from = to - count + 1;
    } else {
      from = hunkEnd(shown[lastIndex - 1]) + 1 + loaded.length;
      to = from + count - 1;
    }
    setLoading(gap);
    setError(null);
    try {
      const { data } = await client.query({ query: GET_PULL_FILE_LINES, variables: { ticketKey: props.ticketKey, url: props.pullUrl, path: file.path, ref: props.headSha, from, to } });
      const lines: string[] = data?.pullFileLines ?? [];
      setExtra((current) => ({ ...current, [gap]: gap < lastIndex ? { lines: [...lines, ...loaded], end: false } : { lines: [...loaded, ...lines], end: lines.length < count } }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The lines could not be loaded');
    } finally {
      setLoading(null);
    }
  };

  const contextLines = (gap: number): DiffLine[] => {
    const lines = extra[gap]?.lines ?? [];
    if (!lines.length) return [];
    if (gap < lastIndex) {
      const hunk = shown[gap];
      const start = hunk.newStart - lines.length;
      return lines.map((text, index) => ({ kind: 'context', newLine: start + index, oldLine: start + index + hunk.oldStart - hunk.newStart, text }));
    }
    const last = shown[lastIndex - 1];
    const start = hunkEnd(last) + 1;
    const shift = last.oldStart + last.oldCount - (last.newStart + last.newCount);
    return lines.map((text, index) => ({ kind: 'context', newLine: start + index, oldLine: start + index + shift, text }));
  };

  const cards = (line: DiffLine | null) => {
    if (!line || line.newLine === null || line.kind === 'del') return null;
    const here = anchors.filter((anchor) => anchor.line === line.newLine);
    if (!here.length) return null;
    return (
      <div className="sticky left-0 flex w-[min(100%,calc(100vw-3rem))] max-w-3xl flex-col gap-2 px-3 py-2 pl-[6.5rem] max-[760px]:pl-3">
        {here.map((anchor) => <FindingCard key={`${anchor.finding}-${anchor.part}`} finding={props.findings[anchor.finding]} anchor={anchor} place={props.placeOf(anchor)} total={props.total} onStep={(delta) => props.onStep(anchor, delta)} />)}
      </div>
    );
  };

  const marked = (line: DiffLine | null) => Boolean(line && line.newLine !== null && line.kind !== 'del' && anchors.some((anchor) => anchor.line === line.newLine));

  const unifiedLine = (line: DiffLine, key: string) => (
    <React.Fragment key={key}>
      <div className={cn(ROW, 'grid-cols-[3.25rem_3.25rem_1.25rem_minmax(0,1fr)] max-[760px]:grid-cols-[2.5rem_1.25rem_minmax(0,1fr)]', KIND_STYLE[line.kind], marked(line) && 'shadow-[inset_3px_0_0_var(--color-status-warn)]')}>
        <span className={cn(NUMBER, 'max-[760px]:hidden')}>{line.oldLine ?? ''}</span>
        <span className={NUMBER}>{line.newLine ?? ''}</span>
        <span className={cn('select-none text-center', line.kind === 'add' ? 'text-status-merged' : line.kind === 'del' ? 'text-status-conflict' : 'text-muted-foreground')}>{SIGN[line.kind]}</span>
        <code className="whitespace-pre pr-4 text-foreground">{line.text || ' '}</code>
      </div>
      {cards(line)}
    </React.Fragment>
  );

  const half = (line: DiffLine | null, side: 'left' | 'right') => (
    <div className={cn('grid grid-cols-[3.25rem_1.25rem_minmax(0,1fr)] font-mono text-[0.74rem] leading-5', line ? KIND_STYLE[line.kind] : 'bg-surface-1/50', side === 'left' && 'border-r border-border', side === 'right' && marked(line) && 'shadow-[inset_3px_0_0_var(--color-status-warn)]')}>
      <span className={NUMBER}>{line ? (side === 'left' ? line.oldLine : line.newLine) ?? '' : ''}</span>
      <span className={cn('select-none text-center', line?.kind === 'add' ? 'text-status-merged' : line?.kind === 'del' ? 'text-status-conflict' : 'text-muted-foreground')}>{line ? SIGN[line.kind] : ''}</span>
      <code className="whitespace-pre-wrap break-all pr-3 text-foreground">{line ? line.text || ' ' : ''}</code>
    </div>
  );

  const splitLines = (lines: DiffLine[], key: string) => splitRows(lines).map((row, index) => (
    <React.Fragment key={`${key}-${index}`}>
      <div className="grid grid-cols-2">{half(row.left, 'left')}{half(row.right, 'right')}</div>
      {cards(row.right)}
    </React.Fragment>
  ));

  const renderLines = (lines: DiffLine[], key: string) => (view === 'split' ? splitLines(lines, key) : lines.map((line, index) => unifiedLine(line, `${key}-${index}`)));

  const expandRow = (gap: number, header: string | null) => {
    const left = remaining(gap);
    const label = left === Infinity ? 'Expand' : `Expand ${left} ${left === 1 ? 'line' : 'lines'}`;
    if (left === 0 && header === null) return null;
    return (
      <div className="flex min-w-full items-center gap-2 bg-status-discord-bg/60 px-2 py-0.5 font-mono text-[0.7rem] text-status-discord max-[760px]:text-xs">
        {left > 0 && (
          <button type="button" onClick={() => void expand(gap)} disabled={loading === gap} className="flex min-h-6 flex-none items-center gap-1 whitespace-nowrap rounded-xs border-0 bg-transparent px-1 text-muted-foreground hover:text-foreground max-[760px]:min-h-9">
            <UnfoldVertical size={12} aria-hidden="true" />{loading === gap ? 'Loading' : label}
          </button>
        )}
        {header && <span className="truncate">{header}</span>}
      </div>
    );
  };

  return (
    <div className="overflow-x-auto">
      {shown.map((hunk, index) => (
        <React.Fragment key={hunk.header + index}>
          {expandRow(index, hunk.header)}
          {renderLines(contextLines(index), `x${index}`)}
          {renderLines(hunk.lines, `h${index}`)}
        </React.Fragment>
      ))}
      {renderLines(contextLines(lastIndex), 'tail')}
      {/* An added or removed file is whole in the diff, so nothing follows its last hunk. */}
      {lastIndex > 0 && file.status !== 'added' && file.status !== 'removed' && expandRow(lastIndex, null)}
      {error && <p className="px-3 py-2 text-xs text-status-conflict" role="alert">{error}</p>}
    </div>
  );
};
