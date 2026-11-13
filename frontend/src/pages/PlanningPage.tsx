import React, { useEffect, useState } from 'react';
import { Page, PageHeader } from '../components/ui';
import { PlanningTab } from '../agents/PlanningTab';
import { PlanTab } from '../agents/PlanTab';
import { RetroTab } from '../agents/RetroTab';
import { planningRoute, type PlanningPageTab } from '../agents/plan';
import { cn } from '../lib/cn';

const TABS: Array<[PlanningPageTab, string]> = [['draft', 'Draft'], ['plan', 'Plan'], ['retro', 'Retro']];

/** Planning, out of Agents: the sprint Draft the planner publishes, the published Plan, and the Retro. */
const PlanningPage: React.FC = () => {
  const [route] = useState(() => planningRoute(window.location.search));
  const [tab, setTab] = useState<PlanningPageTab>(route.tab);
  useEffect(() => {
    const follow = () => setTab(planningRoute(window.location.search).tab);
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);
  const choose = (next: PlanningPageTab) => {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', next);
    if (next !== 'draft') params.delete('panel');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  };
  return (
    <Page width="full" className="max-[760px]:pb-28">
      <PageHeader>
        <div>
          <h1 className="text-balance font-display text-3xl font-black">Planning</h1>
          <p className="mt-1 text-pretty text-secondary-foreground">The sprint draft and its publish, the dependency map and work order, and the retro of the agents' work.</p>
        </div>
      </PageHeader>
      <div className="mb-4 flex border-b border-border" role="tablist" aria-label="Planning">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => choose(id)}
            className={cn('-mb-px flex h-10 items-center gap-1.5 border-b-2 border-transparent px-4 font-display text-sm font-semibold text-secondary-foreground transition-colors duration-150 max-[760px]:h-11', tab === id && 'border-accent text-foreground')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'draft' ? <PlanningTab initialPanel={route.panel ?? undefined} /> : tab === 'plan' ? <PlanTab /> : <RetroTab />}
    </Page>
  );
};

export default PlanningPage;
