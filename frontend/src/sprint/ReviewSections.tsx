import { Badge } from '../components/ui';
import { fmt, fmt0, pct } from './format';
import { Dash, IssueTags, Name, Num, OptionalTone, SectionCard, Table, ToneBadge, Tr } from './SprintParts';
import type { Flag, ReviewerRow, SprintResult, StageName, StageRow } from './types';

const STAGES: StageName[] = ['In Progress', 'PR Review', 'UAT Merged', 'UAT Check', 'RFP'];

export const ReviewQualitySection = ({ rows, unattributedSP }: { rows: ReviewerRow[]; unattributedSP: number }) => (
  <SectionCard
    title="Review quality"
    sub={<>Each UAT Check → UAT Bug push-back this sprint is charged to the reviewer whose pass label most recently preceded it. Fail rate = SP failed QA ÷ SP reviewed.{unattributedSP > 0 && ` Unattributed: ${fmt(unattributedSP)} SP pushed back with no prior self-authored pass label.`}</>}
  >
    <Table minWidth={820} head={[{ label: 'Reviewer' }, { label: 'SP reviewed', numeric: true }, { label: 'Distinct issues', numeric: true }, { label: 'SP failed QA', numeric: true }, { label: 'Fail rate', numeric: true }, { label: 'Bounced issues' }]}>
      {rows.map((row) => (
        <Tr key={row.dev}>
          <Name>{row.dev}</Name>
          <Num>{fmt0(row.sp)}</Num>
          <Num>{row.issues}</Num>
          <Num>{fmt0(row.failedSP)}</Num>
          <Num>{row.failRate === null ? <Dash /> : <OptionalTone tone={row.failTone}>{pct(row.failRate)}</OptionalTone>}</Num>
          <IssueTags issues={row.bounced} />
        </Tr>
      ))}
    </Table>
  </SectionCard>
);

export const ReviewDurationSection = ({ rows, teamAvg }: { rows: ReviewerRow[]; teamAvg: number | null }) => (
  <SectionCard
    title="Review duration"
    sub={`Volume and speed. Average days: green up to 2d, amber 2 to 3d, red above 3d.${teamAvg === null ? '' : ` Team average SP reviewed = ${Math.round(teamAvg)}; below 50% (${Math.round(teamAvg / 2)} SP) flags a workload imbalance.`}`}
  >
    <Table minWidth={680} head={[{ label: 'Reviewer' }, { label: 'Issues', numeric: true }, { label: 'SP reviewed', numeric: true }, { label: 'Avg days', numeric: true }, { label: 'Max days', numeric: true }, { label: 'SLA breaches', numeric: true }]}>
      {rows.map((row) => (
        <Tr key={row.dev}>
          <Name>{row.dev}</Name>
          <Num>{row.issues}</Num>
          <Num>{fmt(row.sp)}</Num>
          <Num>{row.avg === null ? <Dash /> : <OptionalTone tone={row.avgTone}>{row.avg.toFixed(1)}</OptionalTone>}</Num>
          <Num>{row.max === null ? <Dash /> : row.max.toFixed(1)}</Num>
          <Num>{row.avg === null ? <Dash /> : row.breaches}</Num>
        </Tr>
      ))}
    </Table>
  </SectionCard>
);

export const StageSection = ({ rows }: { rows: StageRow[] }) => (
  <SectionCard title="Pipeline stage duration" sub="Average working days per stage. Green up to 1.2d, amber 1.2 to 2d, red above 2d. RFP: green up to 3d, amber 3 to 7d, red above 7d.">
    <Table minWidth={640} head={[{ label: 'Developer' }, ...STAGES.map((label) => ({ label, numeric: true }))]}>
      {rows.map((row) => (
        <Tr key={row.dev}>
          <Name>{row.dev}</Name>
          {STAGES.map((stage) => {
            const cell = row.stages[stage];
            return <Num key={stage}>{cell ? <ToneBadge tone={cell.tone}>{cell.value.toFixed(1)}</ToneBadge> : <Dash />}</Num>;
          })}
        </Tr>
      ))}
    </Table>
  </SectionCard>
);

const FLAG_LABEL: Record<Flag['sev'], { text: string; variant: 'danger' | 'warn' | 'accent' }> = {
  R: { text: 'Red', variant: 'danger' },
  A: { text: 'Amber', variant: 'warn' },
  B: { text: 'Blue', variant: 'accent' },
};

export const FlagsSection = ({ flags }: { flags: SprintResult['flags'] }) => (
  <SectionCard title="Flags and alerts" sub="Generated from the metric thresholds, most severe first.">
    {flags.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No flags for this sprint.</p> : (
      <ul className="m-0 list-none divide-y divide-border p-0">
        {flags.map((flag) => (
          <li key={`${flag.dev}-${flag.metric}-${flag.sev}`} className="grid grid-cols-[110px_80px_1fr] items-center gap-3 px-4 py-2.5 text-sm max-[640px]:grid-cols-[90px_70px_1fr]">
            <strong className="font-display">{flag.dev}</strong>
            <span><Badge variant={FLAG_LABEL[flag.sev].variant}>{FLAG_LABEL[flag.sev].text}</Badge></span>
            <span>{flag.desc}</span>
          </li>
        ))}
      </ul>
    )}
  </SectionCard>
);
