import { Card } from '../components/ui';
import { fmt } from './format';
import type { SprintResult } from './types';

export const MethodNotes = ({ result }: { result: SprintResult }) => {
  const { notes } = result;
  const lines: string[] = [
    `A ticket is in the sprint when it carries the sprint's label (${result.sprint.label}) and is still in the sprint at the cutoff. ${notes.noSprintLabel} ticket(s) in the Jira sprint have no such label and are left out.`,
    `Cutoff = ${result.cutoff}: the latest event for an active sprint, the end of the planned end date for a closed one. The start snapshot is taken at the start of the sprint's first day (+08:00), or at creation for tickets created later. ${notes.addedAfterStart} ticket(s) joined after the start.`,
    'Each ticket uses its current assignee and current SP. Carryover = a ticket that was also in an earlier labelled sprint, bugs included. Bug = any other ticket of type Bug. Allocated = the rest.',
    'Durations are in working days on +08:00 calendar days, with no public holidays. A weekend day counts as 0.12 of a day; that weight is fitted to the reference dashboard, not derived, so sections 08 and 09 are approximate. Stage duration sums each ticket's time in a stage inside the sprint, including the stage it is still in.',
  ];
  lines.push(`A pass is a roster pass label added by its own owner. ${notes.nonSelfPass.length} label(s) added by someone else are ignored${notes.nonSelfPass.length ? `: ${notes.nonSelfPass.map((p) => `${p.key} ${p.token} by ${p.by || 'unknown'}`).join('; ')}` : ''}; ${notes.prePassIgnored} pass(es) from before the sprint start are ignored; ${notes.passWithoutDuration} pass(es) given outside PR Review have no duration.`);
  lines.push(`${notes.revertedToUatMerged} issue(s) were sent from UAT Check back to UAT Merged without a UAT Bug and count as pending.${notes.earlyPushBacks.length ? ` Push-backs within an hour of the start: ${notes.earlyPushBacks.join(', ')}.` : ''}`);
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
