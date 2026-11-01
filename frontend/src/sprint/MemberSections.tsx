import { fmt, fmt0, pct } from './format';
import { Dash, IssueTags, Name, Num, OptionalTone, SectionCard, Table, ToneBadge, Tr } from './SprintParts';
import type { Bucket, EndRow, GateRow, SprintResult, StartRow } from './types';

const BUCKETS: Bucket[] = ['Todo', 'InP', 'PR', 'UATM', 'UATC', 'UATB', 'RFP', 'Done'];
const bucketHead = BUCKETS.map((label) => ({ label, numeric: true }));

export const StartSection = ({ rows, loadTarget }: { rows: StartRow[]; loadTarget: number }) => (
  <SectionCard title="Sprint overview (member): sprint-start snapshot" sub="Starting SP at each status per developer. Bug SP is snapshotted at creation; allocated and carryover at sprint start.">
    <Table minWidth={860} head={[{ label: 'Developer' }, ...bucketHead, { label: 'Total', numeric: true }, { label: `Load vs ${loadTarget}`, numeric: true }]}>
      {rows.map((row) => (
        <Tr key={row.dev}>
          <Name>{row.dev}</Name>
          {BUCKETS.map((bucket) => <Num key={bucket}>{fmt0(row.buckets[bucket])}</Num>)}
          <Num>{fmt(row.total)}</Num>
          <Num><ToneBadge tone={row.loadTone}>{pct(row.load)}</ToneBadge></Num>
        </Tr>
      ))}
    </Table>
  </SectionCard>
);

export const EndSection = ({ rows }: { rows: EndRow[] }) => (
  <SectionCard
    title="End-state distribution and carryover"
    sub="Where each developer's SP sits at the cutoff. Completion = SP that began the sprint below RFP and reached RFP/Done, divided by SP that began below RFP. Carryover = Total − Done."
  >
    <Table minWidth={980} head={[{ label: 'Developer' }, ...bucketHead, { label: 'Total', numeric: true }, { label: 'Completion', numeric: true }, { label: 'Carryover', numeric: true }]}>
      {rows.map((row) => (
        <Tr key={row.dev}>
          <Name>{row.dev}</Name>
          {BUCKETS.map((bucket) => <Num key={bucket}>{fmt0(row.buckets[bucket])}</Num>)}
          <Num>{fmt(row.total)}</Num>
          <Num>
            {row.completion === null ? <Dash /> : (
              <span className="inline-flex items-center gap-2">
                <OptionalTone tone={row.completionTone}>{pct(row.completion)}</OptionalTone>
                <span className="text-[0.65rem] text-muted-foreground max-[760px]:text-xs">{fmt(row.compSP)}/{fmt(row.eligSP)} SP</span>
              </span>
            )}
          </Num>
          <Num>{fmt0(row.carryover)}</Num>
        </Tr>
      ))}
    </Table>
  </SectionCard>
);

export const VelocitySection = ({ rows }: { rows: EndRow[] }) => (
  <SectionCard title="Dev velocity (UAT-bounded)" sub="SP still in dev stages versus SP past UAT Merged. Velocity = review stage ÷ total.">
    <Table minWidth={560} head={[{ label: 'Developer' }, { label: 'In development', numeric: true }, { label: 'Review stage', numeric: true }, { label: 'Dev velocity', numeric: true }]}>
      {rows.map((row) => (
        <Tr key={row.dev}>
          <Name>{row.dev}</Name>
          <Num>{fmt0(row.inDev)}</Num>
          <Num>{fmt0(row.review)}</Num>
          <Num>{row.velocity === null ? <Dash /> : <OptionalTone tone={row.velocityTone}>{pct(row.velocity)}</OptionalTone>}</Num>
        </Tr>
      ))}
    </Table>
  </SectionCard>
);

export const GateSection = ({ title, sub, rows }: { title: string; sub: string; rows: GateRow[] }) => (
  <SectionCard title={title} sub={sub}>
    <Table minWidth={820} head={[{ label: 'Developer' }, { label: 'SP passed', numeric: true }, { label: 'SP reworked', numeric: true }, { label: 'SP pending', numeric: true }, { label: 'Pass rate', numeric: true }, { label: 'Challenging issues' }]}>
      {rows.map((row) => (
        <Tr key={row.dev}>
          <Name>{row.dev}</Name>
          <Num>{fmt0(row.passed)}</Num>
          <Num>{fmt0(row.reworked)}</Num>
          <Num>{fmt0(row.pending)}</Num>
          <Num>{row.rate === null ? <Dash /> : <OptionalTone tone={row.rateTone}>{pct(row.rate)}</OptionalTone>}</Num>
          <IssueTags issues={row.challenging} />
        </Tr>
      ))}
    </Table>
  </SectionCard>
);

export const GateSections = ({ result }: { result: SprintResult }) => (
  <>
    <GateSection
      title="Code readiness rate"
      sub="PR Review gate. Scope = issues that entered PR Review this sprint. Pass rate = SP passed ÷ (SP passed + SP reworked). Pending issues are left out of the denominator."
      rows={result.pr}
    />
    <GateSection
      title="QA pass rate"
      sub="UAT Check gate. Scope = issues that entered UAT Check this sprint. Pass rate = SP passed ÷ (SP passed + SP reworked), where reworked means pushed back to UAT Bug. Pending issues are left out."
      rows={result.qa}
    />
  </>
);
