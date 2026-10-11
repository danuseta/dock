import { Card } from '../components/ui';
import { fmt } from './format';
import type { SprintResult } from './types';

export const MethodNotes = ({ result }: { result: SprintResult }) => {
  const { notes } = result;
  const lines: string[] = [
    `A ticket is in the sprint when it carries the sprint's label (${result.sprint.label}) and is still in the sprint when the data was fetched. ${notes.noSprintLabel} ticket(s) in the Jira sprint have no such label and are left out. Tickets with the label that are not in the sprint are listed below as excluded.`,
    `Cutoff = ${result.cutoff}: the latest event for an active sprint; for a closed one the start of the day (+08:00) on which the next sprint starts, capped at the fetch time and the latest event, or the time set for it under cutoffs in the config. The start snapshot is taken at the start of the sprint's first day (+08:00), or at creation for tickets created later; a bug that was not in an earlier labelled sprint is taken at its creation. ${notes.addedAfterStart} ticket(s) joined after the start.`,
    'Each ticket uses its current assignee and current SP. A ticket assigned to someone outside the roster counts in the pipeline and the Done card only. Carryover = a ticket that was also in an earlier labelled sprint, bugs included. Bug = any other ticket of type Bug. Allocated = the rest.',
    'Durations are in working days on +08:00 calendar days, with no public holidays. A duration is the elapsed days times the share of Monday-to-Friday dates among the dates the interval touches, so a weekend inside an interval shortens it and only an interval that lies within a weekend counts as zero. Stage duration sums the time each ticket spent in a stage inside the sprint, including the stage it is still in, which is counted from the later of its entry and the sprint start to the end of the cutoff day (the cutoff itself for a closed sprint), moved to Monday when that end falls on a weekend; a stage with no time is left out of the average.',
  ];
  lines.push(`A pass is a roster pass label added by its own owner. ${notes.nonSelfPass.length} label(s) added by someone else are ignored${notes.nonSelfPass.length ? `: ${notes.nonSelfPass.map((p) => `${p.key} ${p.token} by ${p.by || 'unknown'}`).join('; ')}` : ''}; ${notes.prePassIgnored} pass(es) from before the sprint start are ignored; passes on labelled tickets of the neighbouring sprints count too, a second pass on the same ticket adds a duration but not another ticket, and roster members marked reviewer: false are left out; ${notes.passWithoutDuration} pass(es) given outside PR Review have no duration.`);
  lines.push(`${notes.revertedToUatMerged} issue(s) were sent from UAT Check back to UAT Merged without a UAT Bug; one that has not passed and is no longer in UAT Check is out of the QA gate's scope, not pending.${notes.earlyPushBacks.length ? ` Push-backs within an hour of the start: ${notes.earlyPushBacks.join(', ')}.` : ''}`);
  if (notes.aliasHits.length) lines.push(`Non-engineering statuses mapped to To Do: ${notes.aliasHits.map((a) => `${a.status} (${a.count}×, ${a.keys.join(', ')})`).join('; ')}.`);

  return (
    <section className="mb-6">
      <h2 className="font-display text-xl font-bold">Method notes</h2>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">Details the metric text leaves open, and the reading used here.</p>
      <Card className="p-4">
        <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-secondary-foreground">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {notes.excluded.length > 0 && (
          <div className="mt-4 border-t border-border pt-3 text-sm">
            <p className="mb-2 text-muted-foreground">Excluded from every calculation:</p>
            <ul className="m-0 list-disc space-y-1 pl-5 text-secondary-foreground">
              {notes.excluded.map((issue) => (
                <li key={issue.key}><strong>{issue.key}</strong> {issue.summary} · {issue.assignee || 'unassigned'} · {issue.status} · {issue.sp === null ? 'no' : fmt(issue.sp)} SP · {issue.reason}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
};
