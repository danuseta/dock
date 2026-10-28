import React, { useState } from 'react';
import { useLazyQuery } from '@apollo/client';
import { Check, ChevronRight, X } from 'lucide-react';
import { GET_RUN_THINKING_RAW } from '../graphql/queries';
import { cn } from '../lib/cn';
import { clock, groupRows, isThinking, nextAt, stopName, type ThinkingRawLine, type ThinkingRow } from './thinking';

const KIND: Record<string, string> = { ask: 'ask', decide: 'decide', did: 'did' };

const Row: React.FC<{ runKey: string; row: ThinkingRow; until: string | null }> = ({ runKey, row, until }) => {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [loadRaw, raw] = useLazyQuery<{ runThinkingRaw: ThinkingRawLine[] }>(GET_RUN_THINKING_RAW);
  const thinking = isThinking(row);
  const opens = row.options.length > 0 || thinking;
  const toggleRaw = () => {
    if (!showRaw && !raw.called) void loadRaw({ variables: { key: runKey, at: row.at, until } });
    setShowRaw((value) => !value);
  };
  return (
    <li className="relative grid grid-cols-[40px_14px_minmax(0,1fr)] gap-x-2 py-[5px] before:absolute before:bottom-0 before:left-[54px] before:top-0 before:w-px before:bg-border">
      <time className="pt-0.5 text-right font-mono text-[0.66rem] tabular-nums text-muted-foreground" dateTime={row.at}>{clock(row.at)}</time>
      <span className="relative z-[1] mt-0.5 grid size-3.5 place-items-center bg-surface-0" aria-hidden="true">
        <i className={cn('block rounded-full', thinking ? 'size-2 border-[1.5px] border-secondary-foreground' : 'size-1.5 bg-border-glow', row.flag && 'border-status-conflict bg-status-conflict')} />
      </span>
      <div className="min-w-0 text-[0.8rem] leading-[1.45] text-secondary-foreground">
        <button
          type="button"
          disabled={!opens}
          aria-expanded={opens ? open : undefined}
          onClick={() => { setOpen((value) => !value); if (open) setShowRaw(false); }}
          className="group block w-full min-w-0 border-0 bg-transparent p-0 text-left disabled:cursor-default"
        >
          {opens && <ChevronRight size={13} aria-hidden="true" className={cn('float-right mt-0.5 text-muted-foreground transition-transform', open && 'rotate-90 text-foreground')} />}
          <span className={cn('mr-1.5 font-mono text-[0.7rem] font-bold', row.flag ? 'text-status-conflict' : thinking ? 'text-foreground' : 'font-semibold text-muted-foreground')}>{row.agent}</span>
          {thinking && KIND[row.kind] && <span className="mr-1.5 font-mono text-[0.66rem] text-muted-foreground">{KIND[row.kind]}</span>}
          <span className={cn('[overflow-wrap:anywhere]', thinking ? 'text-foreground group-enabled:group-hover:underline group-enabled:group-hover:decoration-border-glow group-enabled:group-hover:underline-offset-[3px]' : 'text-secondary-foreground')}>{row.text}</span>
          {row.answer && <span className="text-status-merged"> → {row.answer}</span>}
          {row.flag && <span className="text-muted-foreground"> · {row.flag}</span>}
        </button>
        {open && (
          <div className="mt-1.5 mb-1 grid gap-1.5">
            {row.options.map((option, index) => (
              <div key={index} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 text-[0.76rem]">
                {option.chosen ? <Check size={14} aria-label="chosen" className="mt-px text-status-merged" /> : <X size={14} aria-label="dropped" className="mt-px text-muted-foreground" />}
                <span><b className={option.chosen ? 'font-semibold text-foreground' : 'font-medium text-secondary-foreground'}>{option.label}</b>{option.why && <small className="mt-px block text-[0.72rem] text-muted-foreground">{option.why}</small>}</span>
              </div>
            ))}
            <button type="button" onClick={toggleRaw} className={cn('justify-self-start border-0 bg-transparent p-0 font-mono text-[0.66rem] font-semibold underline underline-offset-[3px]', showRaw ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>raw</button>
            {showRaw && (
              <pre className="m-0 whitespace-pre-wrap rounded-sm border border-border bg-background px-2.5 py-2 font-mono text-[0.68rem] leading-relaxed text-secondary-foreground">
                {raw.loading && 'Loading...'}
                {raw.error && raw.error.message}
                {raw.data && (raw.data.runThinkingRaw.length === 0 ? 'Nothing recorded around this row.' : raw.data.runThinkingRaw.map((line) => (
                  <span key={`${line.at}-${line.text}`} className={cn('block', line.kind === 'note' && 'italic text-muted-foreground')}>{clock(line.at)} {line.agent} · {line.text}</span>
                )))}
              </pre>
            )}
          </div>
        )}
      </div>
    </li>
  );
};

interface ThinkingListProps {
  runKey: string;
  rows: ThinkingRow[];
  /** Every row, for the time window of the raw layer; defaults to rows. */
  allRows?: ThinkingRow[];
  review?: boolean;
  empty?: string;
}

/** Rows grouped under their stage and round, newest first, each opening in place to its options and then its raw activity. */
export const ThinkingList: React.FC<ThinkingListProps> = ({ runKey, rows, allRows, review = false, empty = 'Nothing here yet.' }) => {
  if (rows.length === 0) return <p className="py-5 text-center text-[0.8rem] text-muted-foreground">{empty}</p>;
  const every = allRows ?? rows;
  return (
    <ol className="m-0 list-none p-0">
      {groupRows(rows).map((group) => (
        <React.Fragment key={group.key}>
          <li className="sticky top-0 z-[2] flex items-center gap-2 bg-surface-0 pt-3 pb-1 font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted-foreground after:h-px after:flex-1 after:bg-border">
            <span>{stopName(group.stageIndex, review)}</span><span className="font-medium normal-case tracking-normal">R{group.round}</span>
          </li>
          {group.rows.map((row) => <Row key={row.id} runKey={runKey} row={row} until={nextAt(every, row)} />)}
        </React.Fragment>
      ))}
    </ol>
  );
};
