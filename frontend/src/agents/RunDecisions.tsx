import React, { useState } from 'react';
import type { AgentRun } from './runs';
import { DECISION_LABEL, DECISION_TONE, isGuess, reportAge, reportDecisions } from '../lib/sousReport';
import { Badge } from '../components/ui';

/** Decisions past this many start folded. */
const SHOWN = 3;

/**
 * Every decision on the run, newest first: who took it and what it changes. The guesses that wait on the owner are
 * answered on Decisions; here they are only listed.
 */
export const RunDecisions: React.FC<{ run: AgentRun }> = ({ run }) => {
  const [open, setOpen] = useState(false);
  const confirmed = new Set(run.confirmedDecisions ?? []);
  const decisions = reportDecisions(run);
  const waiting = decisions.filter((decision) => isGuess(decision) && !confirmed.has(decision.n));
  const superseded = decisions.filter((decision) => decision.status === 'SUPERSEDED').length;
  const cancelled = decisions.filter((decision) => decision.status === 'CANCELLED').length;
  const folded = [superseded && `${superseded} superseded`, cancelled && `${cancelled} cancelled`].filter(Boolean).join(', ');
  const shown = open ? decisions : decisions.slice(0, SHOWN);

  return (
    <div>
      <p className="mb-1 font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        Decisions{decisions.length > 0 && ` · ${decisions.length}`}{waiting.length > 0 && <span className="text-amber-200"> · {waiting.length} to confirm</span>}
      </p>
      {decisions.length === 0 && <p className="text-sm text-muted-foreground">None recorded yet.</p>}
      <ol className="flex flex-col">
        {shown.map((decision) => {
          const status = decision.status ?? 'DECIDED';
          // An entry that does not say who decided is not claimed for the owner.
          const recorded = status === 'DECIDED' && !decision.by;
          return (
            <li key={decision.n} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border py-1.5 text-[0.82rem] last:border-b-0">
              <span className="font-mono text-[0.68rem] font-bold text-muted-foreground">D-{decision.n}</span>
              <Badge variant={recorded ? 'neutral' : DECISION_TONE[status] ?? 'neutral'} className="text-[0.62rem]" title={`Ledger status ${status}`}>{recorded ? 'Recorded' : DECISION_LABEL[status] ?? status}</Badge>
              {isGuess(decision) && confirmed.has(decision.n) && <Badge variant="success" className="text-[0.62rem]">Confirmed by you</Badge>}
              <span className="font-mono text-[0.68rem] text-muted-foreground">{[decision.by && `by ${decision.by}`, decision.issue && `answers I-${decision.issue}`, decision.at && reportAge(decision.at)].filter(Boolean).join(' · ')}</span>
              <span className="basis-full text-pretty text-foreground">{decision.text}</span>
              {decision.effect && <span className="basis-full text-pretty text-xs text-secondary-foreground"><b className="font-semibold">Effect:</b> {decision.effect}</span>}
              {(decision.alts ?? []).map((alt) => (
                <span key={alt.label} className="basis-full text-pretty text-xs text-muted-foreground"><b className="font-semibold">Other option:</b> {alt.label}{alt.effect && ` (${alt.effect})`}</span>
              ))}
              {decision.supersededBy && <span className="basis-full text-xs text-muted-foreground">Changed by you: D-{decision.supersededBy}</span>}
              {decision.status === 'CANCELLED' && decision.cancelNote && <span className="basis-full text-pretty text-xs text-status-conflict">Cancelled: {decision.cancelNote}</span>}
            </li>
          );
        })}
      </ol>
      {decisions.length > SHOWN && (
        <button type="button" className="mt-1 text-xs font-semibold text-accent hover:underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? 'Show less' : `Show all ${decisions.length}${folded ? ` · ${folded}` : ''}`}
        </button>
      )}
    </div>
  );
};
