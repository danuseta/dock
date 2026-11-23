import React, { useState } from 'react';
import { DatabaseZap, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { ChartScene } from '../components/empty/scenes/ChartScene';
import { Button, Card, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { formatUpdated, sprintOptionLabel } from './format';
import { MethodNotes } from './MethodNotes';
import { EndSection, GateSections, StartSection, VelocitySection } from './MemberSections';
import { OverviewSection } from './OverviewSection';
import { FlagsSection, ReviewDurationSection, ReviewQualitySection, StageSection } from './ReviewSections';
import { SprintSettingsPanel } from './SprintSettingsPanel';
import { TrendSection } from './TrendSection';
import { useSprintDashboard } from './useSprintDashboard';

export const SprintTab: React.FC = () => {
  const [selected, setSelected] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const board = useSprintDashboard(selected);
  const { summary, result, refreshState } = board;

  if (board.loading) return <LoadingSkeleton />;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-pretty text-sm text-secondary-foreground">
          Updated {formatUpdated(summary?.computedAt ?? null)}. Refreshed every morning from Jira, or on demand.
        </p>
        <div className="flex flex-wrap items-center gap-2 max-[760px]:w-full">
          {board.sprints.length > 0 && (
            <Select
              aria-label="Sprint"
              className="w-[min(420px,80vw)] max-[760px]:w-full"
              value={String(summary?.id ?? '')}
              onValueChange={(value) => setSelected(Number(value))}
              options={board.sprints.map((sprint) => ({ value: String(sprint.id), label: sprintOptionLabel(sprint) }))}
            />
          )}
          <Button onClick={() => void board.refresh()} disabled={board.busy || !summary}>
            <RefreshCw size={16} className={cn(board.running && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            Refresh now
          </Button>
          <Button variant="ghost" onClick={() => setShowSettings((open) => !open)} aria-expanded={showSettings}>
            <SettingsIcon size={16} aria-hidden="true" />Settings
          </Button>
        </div>
      </div>

      {board.running && refreshState && (
        <Card className="mb-4" role="status">
          {refreshState.label}{refreshState.total > 0 ? `: ${refreshState.done} of ${refreshState.total}` : '...'}
        </Card>
      )}
      {(board.error || (refreshState?.status === 'error' && refreshState.error)) && (
        <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">{board.error || refreshState?.error}</Card>
      )}
      {summary?.lastError && (
        <Card className="mb-4 border-status-warn text-status-warn" role="alert">
          The last update of this sprint failed, so the numbers below are from {formatUpdated(summary.computedAt)}: {summary.lastError}
        </Card>
      )}

      {showSettings && <SprintSettingsPanel />}

      {!result ? (
        <Card>
          <EmptyState
            scene={<ChartScene />}
            description={`No sprint data yet. The board and the team are read from Jira, so just load the last ${board.backfillCount} sprints.`}
            action={(
              <Button variant="primary" onClick={() => void board.backfill()} disabled={board.busy}>
                <DatabaseZap size={16} aria-hidden="true" />Load last {board.backfillCount} sprints
              </Button>
            )}
          />
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {result.sprint.name} · {result.sprint.state === 'active' ? 'in progress, partial data' : 'closed'} · cutoff {formatUpdated(result.cutoff)}
          </p>
          <OverviewSection result={result} />
          <StartSection rows={result.start} loadTarget={result.overview.loadTarget} />
          <EndSection rows={result.end} />
          <VelocitySection rows={result.end} />
          <GateSections result={result} />
          <ReviewQualitySection rows={result.reviewers} unattributedSP={result.unattributedSP} />
          <ReviewDurationSection rows={result.reviewers} teamAvg={result.teamAvgSPReviewed} />
          <StageSection rows={result.stages} />
          <FlagsSection flags={result.flags} />
          <TrendSection trend={board.trend} />
          <MethodNotes result={result} />
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => void board.backfill()} disabled={board.busy}>
              <DatabaseZap size={14} aria-hidden="true" />Load last {board.backfillCount} sprints
            </Button>
          </div>
        </>
      )}
    </>
  );
};
