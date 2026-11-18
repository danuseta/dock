import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { CCUSAGE_MISSING, formatCost, formatTokens, subagentShare, type ClaudeSessionUsage } from '../lib/claudeUsage';

const label = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const modelName = (model: string | null) => (model ? model.replace(/^claude-/, '') : '');

export const SessionUsage: React.FC<{ usage: ClaudeSessionUsage | null | undefined }> = ({ usage }) => {
  const shown = usage?.available && usage.found ? usage : null;
  const peak = shown ? Math.max(0, ...shown.agents.map((agent) => agent.peakContext)) : 0;
  return (
    <section className="flex flex-col gap-1.5" aria-label="Usage">
      <h3 className={label}>Usage</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[0.72rem]">
        <dt className="text-muted-foreground">Tokens</dt>
        <dd className="min-w-0 text-right tabular-nums text-secondary-foreground">{shown ? `main ${formatTokens(shown.mainTokens)} · subagents ${formatTokens(shown.totalTokens - shown.mainTokens)}` : '-'}</dd>
        {shown && <><dt className="text-muted-foreground">Subagents</dt><dd className="text-right tabular-nums text-secondary-foreground">{subagentShare(shown)}% of {formatTokens(shown.totalTokens)}</dd></>}
        {shown && shown.agents.length > 0 && <><dt className="text-muted-foreground">Context</dt><dd className="text-right tabular-nums text-secondary-foreground">{shown.agents.length} subagents · peak {formatTokens(peak)}</dd></>}
        <dt className="text-muted-foreground">Cost</dt>
        <dd className="text-right tabular-nums text-secondary-foreground" title={shown ? 'Session total from ccusage, subagents included' : undefined}>{shown ? formatCost(shown.totalCost) : '-'}</dd>
      </dl>
      {usage && !usage.available && <p className="text-pretty text-xs text-muted-foreground">{usage.error ? `ccusage failed: ${usage.error}` : CCUSAGE_MISSING}</p>}
      {shown && shown.agents.length > 0 && (
        <details className="group">
          <summary className={cn(label, 'flex cursor-pointer list-none items-center gap-1 max-[900px]:min-h-11')}>
            <ChevronRight size={12} aria-hidden="true" className="flex-none transition-transform group-open:rotate-90" />Per agent <span className="font-medium tabular-nums">{shown.agents.length}</span>
          </summary>
          <ul className="mt-1 flex flex-col gap-1.5 font-mono text-[0.7rem]">
            {shown.agents.map((agent) => (
              <li key={agent.agentId} className="min-w-0">
                <div className="flex min-w-0 justify-between gap-2"><span className="min-w-0 truncate text-foreground" title={agent.name}>{agent.name}</span><span className="flex-none text-muted-foreground">{modelName(agent.model)}</span></div>
                <div className="flex justify-between gap-2 tabular-nums text-secondary-foreground"><span>{formatTokens(agent.totalTokens)} tok · peak {formatTokens(agent.peakContext)}</span><span title="Session cost split by token weight per model">{formatCost(agent.cost)} <span className="text-muted-foreground">estimate</span></span></div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};
