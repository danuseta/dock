import React, { useState } from 'react';
import type { AgentDecision, AgentRun } from './runs';
import { DECISION_LABEL, DECISION_TONE, isGuess, reportAge, reportDecisions } from '../lib/sousReport';
import { Badge, Button, Checkbox, Input } from '../components/ui';

/** Decisions past this many start folded. */
const SHOWN = 3;

interface RunDecisionsProps {
  run: AgentRun;
  /** Records the owner's confirmation of guessed decisions; no session runs. Rejects with the reason when it cannot. */
  onConfirm: (ns: number[]) => Promise<void>;
  /** Each change starts a new sous session on the ticket's machine; rejects with the reason when it cannot. */
  onChange: (decision: number, choice: string) => Promise<void>;
  busy: boolean;
  /** Why this DOCK cannot act; hides the controls. */
  readOnly?: string | null;
  /** Only the guessed decisions still waiting on the owner, unfolded (Needs Attention). */
  pendingOnly?: boolean;
}

type Decision = AgentDecision & { n: number };

const ChangeForm: React.FC<{ decision: Decision; busy: boolean; onChange: RunDecisionsProps['onChange']; onClose: () => void }> = ({ decision, busy, onChange, onClose }) => {
  const [text, setText] = useState('');
  const send = (choice: string) => { if (choice.trim()) void onChange(decision.n, choice.trim()).then(onClose, () => undefined); };
  return (
    <div className="flex basis-full flex-wrap items-center gap-2 pt-1">
      {(decision.alts ?? []).map((alt) => (
        <Button key={alt.label} size="sm" className="max-[760px]:h-11" title={alt.effect ?? undefined} disabled={busy} onClick={() => send(alt.label)}>{alt.label}</Button>
      ))}
      <form className="flex min-w-[200px] flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); send(text); }}>
        <Input autoFocus className="h-8 min-w-0 flex-1 text-sm max-[760px]:h-11" value={text} placeholder={decision.alts?.length ? 'Or write what it should be...' : 'What it should be, for the agent...'} aria-label={`New decision for D-${decision.n}`} disabled={busy} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} />
        <Button size="sm" variant="primary" type="submit" disabled={busy || !text.trim()}>Change D-{decision.n}</Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Keep</Button>
      </form>
    </div>
  );
};

/**
 * Every decision on the run, newest first: who took it, what it changes, and for what the agent decided on the owner's
 * behalf a Confirm (recorded only) or a Change (a new session revises the work). The pull requests stay draft until
 * every such decision is confirmed or changed.
 */
export const RunDecisions: React.FC<RunDecisionsProps> = ({ run, onConfirm, onChange, busy, readOnly, pendingOnly }) => {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState<number | null>(null);
  const [kept, setKept] = useState<Set<number> | null>(null);
  const confirmed = new Set(run.confirmedDecisions ?? []);
  const all = reportDecisions(run);
  const waiting = all.filter((decision) => isGuess(decision) && !confirmed.has(decision.n));
  const decisions = pendingOnly ? waiting : all;
  const superseded = all.filter((decision) => decision.status === 'SUPERSEDED').length;
  const cancelled = all.filter((decision) => decision.status === 'CANCELLED').length;
  const folded = [superseded && `${superseded} superseded`, cancelled && `${cancelled} cancelled`].filter(Boolean).join(', ');
  const shown = open || pendingOnly ? decisions : decisions.slice(0, SHOWN);
  const confirming = kept ? waiting.filter((decision) => !kept.has(decision.n)).map((decision) => decision.n) : [];
  const toggleKept = (n: number) => setKept((current) => {
    const next = new Set(current);
    if (next.has(n)) next.delete(n); else next.add(n);
    return next;
  });
  const confirmBatch = () => { void onConfirm(confirming).then(() => setKept(null), () => undefined); };

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Decisions{decisions.length > 0 && ` · ${decisions.length}`}{!pendingOnly && waiting.length > 0 && <span className="text-amber-200"> · {waiting.length} to confirm</span>}
        </p>
        {!readOnly && waiting.length > 1 && !kept && <Button size="sm" variant="ghost" className="h-7 px-2 max-[760px]:h-11" disabled={busy} onClick={() => { setKept(new Set()); setOpen(true); }}>Confirm all except…</Button>}
      </div>
      {decisions.length === 0 && <p className="text-sm text-muted-foreground">{pendingOnly ? 'Nothing to confirm.' : 'None recorded yet.'}</p>}
      <ol className="flex flex-col">
        {shown.map((decision) => {
          const status = decision.status ?? 'DECIDED';
          // An entry that does not say who decided is not claimed for the owner.
          const recorded = status === 'DECIDED' && !decision.by;
          const guess = isGuess(decision);
          const pending = guess && !confirmed.has(decision.n);
          return (
            <li key={decision.n} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border py-1.5 text-[0.82rem] last:border-b-0">
              {kept && pending && (
                <label className="flex items-center gap-1.5 self-center text-xs text-muted-foreground">
                  <Checkbox checked={kept.has(decision.n)} onChange={() => toggleKept(decision.n)} aria-label={`Keep D-${decision.n} open`} />keep open
                </label>
              )}
              <span className="font-mono text-[0.68rem] font-bold text-muted-foreground">D-{decision.n}</span>
              <Badge variant={recorded ? 'neutral' : DECISION_TONE[status] ?? 'neutral'} className="text-[0.62rem]" title={`Ledger status ${status}`}>{recorded ? 'Recorded' : DECISION_LABEL[status] ?? status}</Badge>
              {guess && confirmed.has(decision.n) && <Badge variant="success" className="text-[0.62rem]">Confirmed by you</Badge>}
              <span className="font-mono text-[0.68rem] text-muted-foreground">{[decision.by && `by ${decision.by}`, decision.issue && `answers I-${decision.issue}`, decision.at && reportAge(decision.at)].filter(Boolean).join(' · ')}</span>
              <span className="basis-full text-pretty text-foreground">{decision.text}</span>
              {decision.effect && <span className="basis-full text-pretty text-xs text-secondary-foreground"><b className="font-semibold">Effect:</b> {decision.effect}</span>}
              {(decision.alts ?? []).map((alt) => (
                <span key={alt.label} className="basis-full text-pretty text-xs text-muted-foreground"><b className="font-semibold">Other option:</b> {alt.label}{alt.effect && ` (${alt.effect})`}</span>
              ))}
              {decision.supersededBy && <span className="basis-full text-xs text-muted-foreground">Changed by you: D-{decision.supersededBy}</span>}
              {decision.status === 'CANCELLED' && decision.cancelNote && <span className="basis-full text-pretty text-xs text-status-conflict">Cancelled: {decision.cancelNote}</span>}
              {!readOnly && pending && !kept && changing !== decision.n && (
                <span className="flex basis-full gap-3 pt-0.5">
                  <button type="button" className="text-sm font-semibold text-status-merged hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 max-[760px]:min-h-11" disabled={busy} onClick={() => { void onConfirm([decision.n]).catch(() => undefined); }}>Confirm</button>
                  <button type="button" className="text-sm font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 max-[760px]:min-h-11" disabled={busy} onClick={() => setChanging(decision.n)}>Change</button>
                </span>
              )}
              {changing === decision.n && <ChangeForm decision={decision} busy={busy} onChange={onChange} onClose={() => setChanging(null)} />}
            </li>
          );
        })}
      </ol>
      {kept && (
        <div className="sticky bottom-2 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-accent/40 bg-surface-1 px-3 py-2 text-sm">
          <span>{confirming.length} will be confirmed · {kept.size} kept open</span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setKept(null)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={busy || confirming.length === 0} onClick={confirmBatch}>Confirm {confirming.length}</Button>
          </span>
        </div>
      )}
      {readOnly && waiting.length > 0 && <p className="mt-1 text-pretty text-xs text-muted-foreground">{readOnly}</p>}
      {!pendingOnly && decisions.length > SHOWN && (
        <button type="button" className="mt-1 text-xs font-semibold text-accent hover:underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? 'Show less' : `Show all ${decisions.length}${folded ? ` · ${folded}` : ''}`}
        </button>
      )}
    </div>
  );
};
