import React from 'react';
import { Button } from './ui';
import type { SetupGap } from '../lib/setupStatus';

interface FinishSetupViewProps { gaps: SetupGap[]; onNavigate: (path: string) => void }

export const FinishSetupView: React.FC<FinishSetupViewProps> = ({ gaps, onNavigate }) => {
  if (gaps.length === 0) return null;
  return (
    <section className="mb-3.5 rounded-md border border-dashed border-border-glow px-4 py-3" aria-label="Finish setup">
      <h2 className="font-display text-[0.82rem] font-bold">Finish setup</h2>
      <p className="mt-1 text-[0.78rem] text-secondary-foreground">Jira, GitHub and a PIN are the three things DOCK needs. Discord, Calendar and plugins can wait.</p>
      <ul className="mt-2 grid gap-1">
        {gaps.map((gap) => (
          <li key={gap.section} className="flex items-center gap-2 text-[0.8rem]">
            <span>{gap.label}: {gap.missing}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onNavigate(`/settings?section=${gap.section}`)}>Open {gap.label} →</Button>
          </li>
        ))}
      </ul>
    </section>
  );
};
