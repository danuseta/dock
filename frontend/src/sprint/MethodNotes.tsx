import { Card } from '../components/ui';
import { fmt } from './format';
import type { SprintResult } from './types';

export const MethodNotes = ({ result }: { result: SprintResult }) => {
  const { notes } = result;
  const lines: string[] = [
    `Cutoff = ${result.cutoff} (latest event in the data for an active sprint, the sprint end for a closed one). Working days are Monday to Friday on +08:00 calendar days, fractional, with no public holidays.`,
    `Sprint-start state is replayed from the events. ${notes.addedAfterStart} issue(s) joined after the start and are snapshotted when they joined; ${notes.noSprintEvents} issue(s) have no Sprint events and count as members from creation.`,
    'Bug = issue type Bug, at its first estimate. Carryover = a non-bug issue that already belonged to an earlier sprint when it joined. Allocated = every other non-bug issue.',
  ];
  if (notes.spChanges.length) lines.push(`One SP value per issue (the snapshot) is used everywhere. Current SP differs on: ${notes.spChanges.map((c) => `${c.key} ${fmt(c.from)}→${c.to === null ? 'none' : fmt(c.to)}`).join(', ')}.`);
  if (notes.assigneeChanges.length) lines.push(`Tickets belong to the developer assigned at the snapshot. Reassigned since: ${notes.assigneeChanges.map((c) => `${c.key} now ${c.now || 'unassigned'}`).join(', ')}.`);
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
