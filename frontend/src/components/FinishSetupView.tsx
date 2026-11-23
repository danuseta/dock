import React from 'react';
import { Button } from './ui';
import type { DockMode } from '../lib/dockMode';
import type { SetupGap } from '../lib/setupStatus';

interface FinishSetupViewProps { gaps: SetupGap[]; mode?: DockMode; onNavigate: (path: string) => void; onHide?: () => void }

export const FinishSetupView: React.FC<FinishSetupViewProps> = ({ gaps, mode = 'workspace', onNavigate, onHide }) => {
  if (gaps.length === 0) return null;
  const later = mode === 'laptop' ? 'Discord, Calendar and plugins can wait.' : 'Discord and plugins can wait.';
  return (
    <section className="mb-3.5 rounded-md border border-dashed border-border-glow px-4 py-3" aria-label="Finish setup">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-[0.82rem] font-bold">Finish setup</h2>
        {onHide && <Button variant="ghost" size="sm" className="ml-auto" onClick={onHide}>Hide</Button>}
      </div>
      <p className="mt-1 text-[0.78rem] text-secondary-foreground">Jira, GitHub and a PIN are the three things DOCK needs. {later}</p>
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
